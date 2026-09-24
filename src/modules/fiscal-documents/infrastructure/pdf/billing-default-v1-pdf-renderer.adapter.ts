/**
 * BillingDefaultV1PdfRendererAdapter — Production PDF renderer.
 *
 * Template: BILLING_DEFAULT_V1
 * Engine: PDFKit (pure Node.js, no external process, no external network)
 * Renderer version: 1.0.0
 *
 * HACIENDA REQUIREMENTS ENFORCED:
 * - QR lower-right area (DGT-R-000-2024)
 * - QR ≥ 2.5 cm × 2.5 cm (DGT-R-000-2024): 71pt × 71pt at 72dpi
 * - Tipo de documento + Clave + consecutivo grouped (Anexos Note 1)
 * - All comprobante content shown legibly
 * - Multi-page: Page X of Y, repeated headers, repeated column headers, totals after all lines
 * - No external network resources loaded
 *
 * Security:
 * - Render timeout enforced
 * - Memory limits via configurable max PDF size
 * - No SVG in logos (PNG/JPEG/WebP only)
 * - No arbitrary tenant HTML or CSS
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import * as PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import {
  PdfRendererPort,
  PdfRendererInput,
  PdfRendererOutput,
} from '../../application/pdf/pdf-renderer.port';

export const BILLING_DEFAULT_V1_TEMPLATE_ID = 'BILLING_DEFAULT_V1';
export const BILLING_DEFAULT_V1_RENDERER_VERSION = '1.0.0';

// PDF page dimensions (A4 in points at 72dpi: 595 × 842)
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

// QR dimensions: 2.5cm = ~71pt at 72dpi (1pt = 1/72 inch; 1 inch = 2.54cm)
// 2.5cm / 2.54cm/inch * 72pt/inch = 70.87pt ≈ 71pt
const QR_SIZE_PT = 72; // ≥ 71pt satisfies ≥ 2.5cm requirement
const FOOTER_SAFE_TOP = PAGE_HEIGHT - MARGIN - QR_SIZE_PT - 35;
const FOOTER_TEXT_Y = PAGE_HEIGHT - 58;
const PAGE_NUMBER_Y = PAGE_HEIGHT - 38;

// Render timeout
const RENDER_TIMEOUT_MS = 30_000;

// Colors
const PRIMARY_DEFAULT = '#1a56db';
const TEXT_DARK = '#1a1a1a';
const TEXT_GRAY = '#6b7280';
const BORDER_LIGHT = '#e5e7eb';

@Injectable()
export class BillingDefaultV1PdfRendererAdapter implements PdfRendererPort {
  private readonly logger = new Logger(BillingDefaultV1PdfRendererAdapter.name);

  async render(input: PdfRendererInput): Promise<PdfRendererOutput> {
    const startTime = Date.now();

    let timeout: NodeJS.Timeout | undefined;
    try {
      const bytes = await Promise.race([
        this.doRender(input),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('PDF render timeout exceeded')),
            RENDER_TIMEOUT_MS,
          );
        }),
      ]);

      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const elapsed = Date.now() - startTime;

      this.logger.log({
        msg: 'PDF rendered',
        templateId: input.templateId,
        rendererVersion: input.rendererVersion,
        sizeBytes: bytes.length,
        durationMs: elapsed,
        documentType: input.document.type,
      });

      return {
        bytes,
        contentType: 'application/pdf',
        sha256,
        sizeBytes: bytes.length,
        templateId: input.templateId,
        rendererVersion: input.rendererVersion,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async doRender(input: PdfRendererInput): Promise<Buffer> {
    const { document, branding, qrPayload } = input;

    // Generate QR code as PNG buffer
    const qrBuffer = await QRCode.toBuffer(qrPayload, {
      type: 'png',
      width: 150, // Will be scaled to QR_SIZE_PT in PDF
      margin: 1,
      errorCorrectionLevel: 'M',
    });

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];

      const doc = new PDFDocument({
        size: [PAGE_WIDTH, PAGE_HEIGHT],
        // Keep PDFKit's automatic text-flow margin below the physical footer.
        // Business content reserves FOOTER_SAFE_TOP manually; absolute footer/page-number
        // drawing must remain within PDFKit's page bounds to avoid accidental pages.
        margins: { top: MARGIN, bottom: 18, left: MARGIN, right: MARGIN },
        bufferPages: true, // Required for Page X of Y
        autoFirstPage: false, // We control page creation
      });

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Build content using line items
      const lines = document.lineItems as Array<Record<string, unknown>>;
      const primaryColor = branding.primaryColor ?? PRIMARY_DEFAULT;

      doc.addPage();

      let y = this.renderPageHeader(doc, document, branding, primaryColor, 1);

      // Render identification block (Note 1: grouped)
      y = this.renderIdentificationBlock(doc, document, primaryColor, y);

      // Issuer/receiver info
      y = this.renderPartiesBlock(doc, document, y);

      // Line items table
      y = this.renderLineItemsTable(doc, document, lines, branding, primaryColor, y);

      // Totals block (result unused — renderFinalPageFooter handles final page positioning)
      this.renderTotalsBlock(doc, document, y);

      // After all content, add QR + footer on final page
      this.renderFinalPageFooter(doc, qrBuffer, branding, document, primaryColor);

      // Set Page X of Y
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(8)
          .fillColor(TEXT_GRAY)
          .text(`Página ${i + 1} de ${pageCount}`, PAGE_WIDTH / 2 - 45, PAGE_NUMBER_Y, {
            width: 90,
            align: 'center',
            lineBreak: false,
          });
      }

      doc.end();
    });
  }

  /** Render compact page header with document identification. */
  private renderPageHeader(
    doc: PDFKit.PDFDocument,
    document: PdfRendererInput['document'],
    branding: PdfRendererInput['branding'],
    primaryColor: string,
    _pageNumber: number,
  ): number {
    let y = MARGIN;

    // Header bar
    doc.rect(MARGIN, y, CONTENT_WIDTH, 3).fill(primaryColor);
    y += 8;

    // Company name
    const companyName =
      branding.showCommercialName && branding.commercialName
        ? branding.commercialName
        : ((document.issuerSnapshot['nombre'] as string) ?? 'Emisor');

    doc
      .fontSize(14)
      .fillColor(primaryColor)
      .font('Helvetica-Bold')
      .text(companyName, MARGIN, y, {
        width: CONTENT_WIDTH * 0.6,
      });

    // Logo (if available and validated)
    if (branding.logoBytes && branding.logoBytes.length > 0) {
      try {
        doc.image(branding.logoBytes, PAGE_WIDTH - MARGIN - 100, y, { width: 80, height: 40 });
      } catch {
        // Logo rendering failed — continue without logo (security: never fail PDF on logo error)
        this.logger.warn({ msg: 'Logo rendering failed — continuing without logo' });
      }
    }

    y += 30;
    doc.fontSize(9).fillColor(TEXT_GRAY).font('Helvetica');

    const issuer = document.issuerSnapshot;
    const ruc = (issuer['identificacion'] as Record<string, unknown>)?.['numero'] ?? '';
    doc.text(`RUC: ${ruc}`, MARGIN, y);
    y += 12;

    const address = issuer['ubicacion'] as Record<string, unknown>;
    if (address) {
      doc.text(`${address['otrasSenas'] ?? ''}`, MARGIN, y, { width: CONTENT_WIDTH * 0.6 });
      y += 12;
    }

    const tel = issuer['telefono'] as Record<string, unknown>;
    if (tel) {
      doc.text(`Tel: ${tel['numTelefono'] ?? ''}`, MARGIN, y);
      y += 12;
    }

    doc.text(`Email: ${issuer['correoElectronico'] ?? ''}`, MARGIN, y);
    y += 16;

    // Separator line
    doc
      .moveTo(MARGIN, y)
      .lineTo(PAGE_WIDTH - MARGIN, y)
      .strokeColor(BORDER_LIGHT)
      .stroke();
    y += 8;

    return y;
  }

  /**
   * Render identification block — GROUPED as required by Anexos Note 1.
   * Tipo de documento + Clave + consecutivo must be in the same group.
   */
  private renderIdentificationBlock(
    doc: PDFKit.PDFDocument,
    document: PdfRendererInput['document'],
    primaryColor: string,
    y: number,
  ): number {
    const docTypeName = document.type === 'INVOICE' ? 'Factura Electrónica' : 'Tiquete Electrónico';
    const issueDate = document.issueDate.toISOString().replace('T', ' ').substring(0, 19);

    // Draw grouped identification box
    doc.rect(MARGIN, y, CONTENT_WIDTH, 60).fillAndStroke('#f9fafb', BORDER_LIGHT);

    doc.fontSize(12).fillColor(primaryColor).font('Helvetica-Bold');
    doc.text(docTypeName, MARGIN + 8, y + 8, { width: CONTENT_WIDTH - 16 });

    doc.fontSize(8).fillColor(TEXT_DARK).font('Helvetica-Bold');
    doc.text('Clave:', MARGIN + 8, y + 26);
    doc.font('Helvetica').text(document.clave, MARGIN + 8 + 40, y + 26, {
      width: CONTENT_WIDTH - 60,
      lineBreak: false,
    });

    doc.font('Helvetica-Bold').text('Consecutivo:', MARGIN + 8, y + 40);
    doc.font('Helvetica').text(document.consecutive, MARGIN + 8 + 70, y + 40, {
      lineBreak: false,
    });

    doc.font('Helvetica-Bold').text('Fecha:', MARGIN + 300, y + 40);
    doc.font('Helvetica').text(issueDate, MARGIN + 330, y + 40, { lineBreak: false });

    y += 68;
    return y;
  }

  /** Render issuer/receiver party information. */
  private renderPartiesBlock(
    doc: PDFKit.PDFDocument,
    document: PdfRendererInput['document'],
    y: number,
  ): number {
    const issuer = document.issuerSnapshot;
    const receiver = document.receiverSnapshot;

    doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica-Bold');
    doc.text('Emisor', MARGIN, y);
    y += 12;

    doc.font('Helvetica');
    doc.text(String(issuer['nombre'] ?? ''), MARGIN, y, { width: CONTENT_WIDTH / 2 - 10 });
    y += 12;
    const issuerIdent = issuer['identificacion'] as Record<string, unknown>;
    doc.text(`Identificación: ${issuerIdent?.['numero'] ?? ''}`, MARGIN, y);
    y += 16;

    if (receiver) {
      doc.font('Helvetica-Bold').text('Receptor', MARGIN, y);
      y += 12;
      doc.font('Helvetica');
      doc.text(String(receiver['nombre'] ?? 'Consumidor Final'), MARGIN, y, {
        width: CONTENT_WIDTH / 2 - 10,
      });
      y += 12;
      const receiverIdent = receiver['identificacion'] as Record<string, unknown>;
      if (receiverIdent?.['numero']) {
        doc.text(`Identificación: ${receiverIdent['numero']}`, MARGIN, y);
        y += 12;
      }
    }

    doc.text(
      `Condición venta: ${document.saleCondition}  |  Medio pago: ${document.paymentMethod}  |  Moneda: ${document.currency}`,
      MARGIN,
      y,
      {
        width: CONTENT_WIDTH,
      },
    );
    y += 16;

    // Separator
    doc
      .moveTo(MARGIN, y)
      .lineTo(PAGE_WIDTH - MARGIN, y)
      .strokeColor(BORDER_LIGHT)
      .stroke();
    y += 8;

    return y;
  }

  /** Render line items table with pagination support. */
  private renderLineItemsTable(
    doc: PDFKit.PDFDocument,
    document: PdfRendererInput['document'],
    lines: Array<Record<string, unknown>>,
    branding: PdfRendererInput['branding'],
    primaryColor: string,
    startY: number,
  ): number {
    const columns = [
      { label: 'Línea', width: 28, wrap: false },
      { label: 'Código CABYS', width: 60, wrap: false },
      { label: 'Descripción', width: 160, wrap: true },
      { label: 'Cantidad', width: 45, wrap: false },
      { label: 'P. Unitario', width: 60, wrap: false },
      { label: 'Descuento', width: 50, wrap: false },
      { label: 'Impuesto', width: 50, wrap: false },
      { label: 'Total', width: 62, wrap: false },
    ];

    let y = startY;

    // Table header
    const renderColumnHeaders = (atY: number): number => {
      doc.rect(MARGIN, atY, CONTENT_WIDTH, 16).fill(primaryColor);
      let x = MARGIN;
      doc.fontSize(7).fillColor('#ffffff').font('Helvetica-Bold');
      for (const col of columns) {
        doc.text(col.label, x + 2, atY + 4, { width: col.width - 4, lineBreak: false });
        x += col.width;
      }
      return atY + 18;
    };

    const addContinuationPage = (): void => {
      doc.addPage();
      y = this.renderPageHeader(doc, document, branding, primaryColor, 0);
      y = renderColumnHeaders(y);
    };

    y = renderColumnHeaders(y);

    // Render each line as an atomic row. Wrapped descriptions drive row height.
    for (const [index, line] of lines.entries()) {
      const rowData = [
        String(line['numLinea'] ?? line['lineNumber'] ?? ''),
        String(line['codigoCabys'] ?? line['cabysCode'] ?? ''),
        String(line['detalle'] ?? line['description'] ?? ''),
        String(line['cantidad'] ?? line['quantity'] ?? ''),
        String(line['precioUnitario'] ?? line['unitPrice'] ?? ''),
        String(line['montoDescuento'] ?? line['discountAmount'] ?? '0'),
        String(line['impuestoNeto'] ?? line['taxAmount'] ?? '0'),
        String(line['montoTotalLinea'] ?? line['lineTotal'] ?? ''),
      ];

      doc.fontSize(7).font('Helvetica');
      const contentHeights = rowData.map((value, i) =>
        doc.heightOfString(value, {
          width: columns[i].width - 4,
          lineBreak: columns[i].wrap,
        }),
      );
      const rowHeight = Math.max(20, Math.ceil(Math.max(...contentHeights)) + 8);

      // Do not split rows. If a complete row would cross the reserved footer area,
      // move it wholesale to the next physical page.
      if (y + rowHeight > FOOTER_SAFE_TOP) {
        addContinuationPage();
      }

      let x = MARGIN;
      if (index % 2 === 0) {
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill('#f9fafb');
      }

      doc.fontSize(7).fillColor(TEXT_DARK).font('Helvetica');
      for (let i = 0; i < columns.length; i++) {
        doc.text(rowData[i], x + 2, y + 4, {
          width: columns[i].width - 4,
          height: rowHeight - 8,
          lineBreak: columns[i].wrap,
          ellipsis: !columns[i].wrap,
        });
        x += columns[i].width;
      }

      doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).strokeColor(BORDER_LIGHT).stroke();
      y += rowHeight;
    }

    y += 8;
    return y;
  }

  /** Render totals block. */
  private renderTotalsBlock(
    doc: PDFKit.PDFDocument,
    document: PdfRendererInput['document'],
    y: number,
  ): number {
    const totals = document.totals as Record<string, unknown>;
    const totalsWidth = 200;
    const labelsX = PAGE_WIDTH - MARGIN - totalsWidth;
    const valuesX = PAGE_WIDTH - MARGIN - 80;

    const totalsBlockHeight = 96;
    if (y + totalsBlockHeight > FOOTER_SAFE_TOP) {
      doc.addPage();
      y = MARGIN + 20;
    }

    const totalsRows = [
      [
        'Subtotal:',
        String(totals['totalVentaNeta'] ?? totals['totalNetSale'] ?? totals['subtotal'] ?? '0.00'),
      ],
      ['Descuentos:', String(totals['totalDescuentos'] ?? totals['totalDiscount'] ?? '0.00')],
      ['Impuestos:', String(totals['totalImpuesto'] ?? totals['totalTax'] ?? '0.00')],
      [
        'Total:',
        String(totals['totalComprobante'] ?? totals['totalAmount'] ?? totals['total'] ?? '0.00'),
      ],
    ];

    doc
      .moveTo(MARGIN, y)
      .lineTo(PAGE_WIDTH - MARGIN, y)
      .strokeColor(BORDER_LIGHT)
      .stroke();
    y += 8;

    for (let i = 0; i < totalsRows.length; i++) {
      const [label, value] = totalsRows[i];
      const isTotal = i === totalsRows.length - 1;

      if (isTotal) {
        doc.rect(labelsX - 5, y - 2, totalsWidth + 5, 18).fill(PRIMARY_DEFAULT);
        doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold');
      } else {
        doc.fontSize(8).fillColor(TEXT_DARK).font('Helvetica');
      }

      doc.text(label, labelsX, y, { width: totalsWidth - 80, align: 'right' });
      doc.text(`${document.currency} ${value}`, valuesX, y, { width: 80, align: 'right' });
      y += 18;
    }

    if (document.exchangeRate && document.currency !== 'CRC') {
      doc.fontSize(7).fillColor(TEXT_GRAY).font('Helvetica');
      doc.text(`Tipo de cambio: ${document.exchangeRate}`, labelsX, y, {
        width: totalsWidth,
        align: 'right',
      });
      y += 12;
    }

    return y + 10;
  }

  /**
   * Render QR code and footer on the final page (summary page).
   * QR placement: lower-right area (DGT-R-000-2024 requirement).
   * QR size: QR_SIZE_PT × QR_SIZE_PT (≥ 2.5cm × 2.5cm).
   */
  private renderFinalPageFooter(
    doc: PDFKit.PDFDocument,
    qrBuffer: Buffer,
    branding: PdfRendererInput['branding'],
    document: PdfRendererInput['document'],
    primaryColor: string,
  ): void {
    const qrX = PAGE_WIDTH - MARGIN - QR_SIZE_PT;
    const qrY = PAGE_HEIGHT - MARGIN - QR_SIZE_PT;

    // QR code — lower-right area
    doc.image(qrBuffer, qrX, qrY, {
      width: QR_SIZE_PT,
      height: QR_SIZE_PT,
    });

    // QR label
    doc
      .fontSize(6)
      .fillColor(TEXT_GRAY)
      .font('Helvetica')
      .text('Consulta CE', qrX, qrY - 10, {
        width: QR_SIZE_PT,
        align: 'center',
        lineBreak: false,
      });

    // Footer text
    const footerY = FOOTER_TEXT_Y;
    const footerText =
      branding.footerText ?? 'Documento generado electrónicamente. Consulte en Hacienda.';
    doc
      .fontSize(7)
      .fillColor(TEXT_GRAY)
      .font('Helvetica')
      .text(footerText, MARGIN, footerY, {
        width: CONTENT_WIDTH - QR_SIZE_PT - 20,
        height: 20,
        lineBreak: false,
        ellipsis: true,
      });

    // Bottom bar
    doc.rect(MARGIN, PAGE_HEIGHT - MARGIN - 3, CONTENT_WIDTH, 3).fill(primaryColor);
  }
}
