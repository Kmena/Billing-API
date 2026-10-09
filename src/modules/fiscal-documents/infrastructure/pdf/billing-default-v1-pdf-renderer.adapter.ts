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
  CompanyBrandingView,
  FiscalRepresentationPdfRendererPort,
  FiscalRepresentationRenderOptions,
  PdfRendererPort,
  PdfRendererInput,
  PdfRendererOutput,
} from '../../application/pdf/pdf-renderer.port';
import {
  FiscalDecimal,
  FiscalLineView,
  FiscalPartyView,
  FiscalRepresentationView,
} from '../../application/fiscal-representation/read-only-fiscal-xml-parser';
import {
  CURRENT_FISCAL_PDF_RENDERER_VERSION,
  CURRENT_FISCAL_PDF_TEMPLATE_ID,
} from '../../application/pdf/fiscal-pdf-version-policy';

export const BILLING_DEFAULT_V1_TEMPLATE_ID = CURRENT_FISCAL_PDF_TEMPLATE_ID;
export const BILLING_DEFAULT_V1_RENDERER_VERSION = '1.0.0';
export const BILLING_DEFAULT_V1_FISCAL_REPRESENTATION_RENDERER_VERSION =
  CURRENT_FISCAL_PDF_RENDERER_VERSION;

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
export class BillingDefaultV1PdfRendererAdapter
  implements PdfRendererPort, FiscalRepresentationPdfRendererPort
{
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

  /**
   * Wave 2 renderer component. It intentionally has no runtime caller yet.
   * The only fiscal source is the immutable, typed representation built from
   * signed XML in Wave 1; layout is the sole responsibility of this method.
   */
  async renderRepresentation(
    view: FiscalRepresentationView,
    options: FiscalRepresentationRenderOptions = {},
  ): Promise<PdfRendererOutput> {
    const startedAt = Date.now();
    const bytes = await this.doRenderRepresentation(view, options);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    this.logger.log({
      msg: 'Fiscal representation PDF component rendered',
      templateId: BILLING_DEFAULT_V1_TEMPLATE_ID,
      rendererVersion: BILLING_DEFAULT_V1_FISCAL_REPRESENTATION_RENDERER_VERSION,
      sizeBytes: bytes.length,
      durationMs: Date.now() - startedAt,
      documentType: view.document.type,
    });
    return {
      bytes,
      contentType: 'application/pdf',
      sha256,
      sizeBytes: bytes.length,
      templateId: BILLING_DEFAULT_V1_TEMPLATE_ID,
      rendererVersion: BILLING_DEFAULT_V1_FISCAL_REPRESENTATION_RENDERER_VERSION,
    };
  }

  private async doRenderRepresentation(
    view: FiscalRepresentationView,
    options: FiscalRepresentationRenderOptions,
  ): Promise<Buffer> {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error('PDF render attempt was aborted.');
    }
    const branding = options.branding;
    const primaryColor = this.safeColor(branding?.primaryColor) ?? PRIMARY_DEFAULT;
    const qrPayload = this.validatedOptionalQr(options);
    const documentLabel =
      view.document.type === 'INVOICE' ? 'Factura Electrónica' : 'Tiquete Electrónico';

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let settled = false;
      const doc = new PDFDocument({
        size: [PAGE_WIDTH, PAGE_HEIGHT],
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        bufferPages: true,
        autoFirstPage: false,
      });
      const cleanup = (): void => options.signal?.removeEventListener('abort', abort);
      const resolveOnce = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(Buffer.concat(chunks));
      };
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abort = (): void => {
        const reason =
          options.signal?.reason instanceof Error
            ? options.signal.reason
            : new Error('PDF render attempt was aborted.');
        rejectOnce(reason);
        doc.destroy(reason);
      };
      doc.on('data', (chunk: Buffer) => {
        if (!settled) chunks.push(chunk);
      });
      doc.once('end', resolveOnce);
      doc.once('error', rejectOnce);
      options.signal?.addEventListener('abort', abort, { once: true });

      const contentBottom = PAGE_HEIGHT - MARGIN - 26;
      let y = MARGIN;
      const newPage = (continuation = false): void => {
        doc.addPage();
        y = MARGIN;
        doc.rect(MARGIN, y, CONTENT_WIDTH, 3).fill(primaryColor);
        y += 9;
        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .fillColor(primaryColor)
          .text(documentLabel, MARGIN, y);
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor(TEXT_GRAY)
          .text(
            `${view.document.clave}  |  ${view.document.consecutive}${continuation ? '  |  Continuación' : ''}`,
            MARGIN,
            y + 15,
            { width: CONTENT_WIDTH },
          );
        y += 30;
      };
      const ensure = (height: number, continuation = true): void => {
        if (y + height > contentBottom) newPage(continuation);
      };
      const heading = (label: string): void => {
        ensure(22);
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(primaryColor)
          .text(label, MARGIN, y, { width: CONTENT_WIDTH });
        y += 13;
        doc
          .moveTo(MARGIN, y)
          .lineTo(PAGE_WIDTH - MARGIN, y)
          .strokeColor(BORDER_LIGHT)
          .stroke();
        y += 6;
      };
      const text = (label: string, value?: string): void => {
        if (!value) return;
        const rendered = `${label}: ${this.safeText(value)}`;
        doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK);
        const height = Math.max(11, doc.heightOfString(rendered, { width: CONTENT_WIDTH }));
        ensure(height + 3);
        doc.text(rendered, MARGIN, y, { width: CONTENT_WIDTH });
        y += height + 3;
      };
      const amount = (label: string, value?: FiscalDecimal): void => {
        if (!value) return;
        text(label, `${view.currency.code} ${value.canonical}`);
      };
      const party = (label: string, person?: FiscalPartyView): void => {
        if (!person) return;
        heading(label);
        text('Nombre', person.legalName);
        text('Nombre comercial', person.commercialName);
        if (person.identification)
          text(
            'Identificación',
            [person.identification.type, person.identification.number].filter(Boolean).join(' '),
          );
        text('Identificación extranjera', person.foreignIdentification);
        text('Registro fiscal 8707', person.fiscalRegistry8707);
        if (person.location) {
          text(
            'Ubicación',
            [
              person.location.province,
              person.location.canton,
              person.location.district,
              person.location.neighborhood,
              person.location.otherSigns,
              person.location.foreignOtherSigns,
            ]
              .filter(Boolean)
              .join(' · '),
          );
        }
        if (person.phone) text('Teléfono', `${person.phone.countryCode} ${person.phone.number}`);
        text('Correo electrónico', person.email);
        text('Actividad económica', person.economicActivity);
      };
      const tableHeader = (): void => {
        ensure(19);
        doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(primaryColor);
        doc.font('Helvetica-Bold').fontSize(6).fillColor('#ffffff');
        const columns = [
          ['#', 18],
          ['CABYS', 60],
          ['Descripción / detalle fiscal', 190],
          ['Cant.', 40],
          ['Unidad', 40],
          ['P. unit.', 50],
          ['Total línea', 62],
        ] as const;
        let x = MARGIN;
        for (const [label, width] of columns) {
          doc.text(label, x + 2, y + 4, { width: width - 4, lineBreak: false });
          x += width;
        }
        y += 19;
      };
      const line = (item: FiscalLineView, index: number): void => {
        const details = [
          item.detail,
          item.commercialCodes.length
            ? `Códigos: ${item.commercialCodes.map((code) => `${code.type}/${code.code}`).join(', ')}`
            : undefined,
          item.commercialUnit ? `Unidad comercial: ${item.commercialUnit}` : undefined,
          item.transactionType ? `Tipo transacción: ${item.transactionType}` : undefined,
          item.vinOrSerialNumbers.length
            ? `VIN/Serie: ${item.vinOrSerialNumbers.join(', ')}`
            : undefined,
          item.medicationRegistration
            ? `Registro medicamento: ${item.medicationRegistration}`
            : undefined,
          item.pharmaceuticalForm ? `Forma farmacéutica: ${item.pharmaceuticalForm}` : undefined,
        ]
          .filter((value): value is string => Boolean(value))
          .map((value) => this.safeText(value))
          .join('\n');
        const row = [
          item.number,
          item.cabys,
          details,
          item.quantity.canonical,
          item.unit,
          item.unitPrice.canonical,
          item.lineTotal.canonical,
        ];
        const widths = [18, 60, 190, 40, 40, 50, 62];
        doc.font('Helvetica').fontSize(6.5);
        const height =
          Math.max(
            20,
            ...row.map((value, column) =>
              doc.heightOfString(this.safeText(value), { width: widths[column] - 4 }),
            ),
          ) + 7;
        if (y + height > contentBottom) {
          newPage(true);
          tableHeader();
        }
        if (index % 2 === 0) doc.rect(MARGIN, y, CONTENT_WIDTH, height).fill('#f9fafb');
        let x = MARGIN;
        doc.font('Helvetica').fontSize(6.5).fillColor(TEXT_DARK);
        row.forEach((value, column) => {
          doc.text(this.safeText(value), x + 2, y + 3, {
            width: widths[column] - 4,
            height: height - 5,
          });
          x += widths[column];
        });
        doc.rect(MARGIN, y, CONTENT_WIDTH, height).strokeColor(BORDER_LIGHT).stroke();
        y += height + 2;
        const detailRows = [
          ['Monto bruto', item.total],
          ['Descuentos', item.discounts.length ? undefined : undefined],
          ['Subtotal', item.subtotal],
          ['Base imponible', item.taxableBase],
          ['IVA cobrado fábrica', item.vatCollectedAtFactory ? undefined : undefined],
          ['Impuesto asumido emisor fábrica', item.issuerAssumedFactoryTax],
          ['Impuesto neto', item.taxNet],
        ] as const;
        detailRows.forEach(([label, value]) => amount(label, value));
        if (item.vatCollectedAtFactory) text('IVA cobrado fábrica', item.vatCollectedAtFactory);
        item.discounts.forEach((discount) => {
          amount(
            `Descuento ${discount.code}${discount.otherCode ? `/${discount.otherCode}` : ''}`,
            discount.amount,
          );
          text('Naturaleza descuento', discount.nature);
        });
        item.taxes.forEach((tax) => {
          text('Impuesto', [tax.code, tax.otherCode, tax.tariffCode].filter(Boolean).join(' / '));
          if (tax.rate) text('Tarifa impuesto', `${tax.rate.canonical}%`);
          if (tax.vatCalculationFactor)
            text('Factor cálculo IVA', tax.vatCalculationFactor.canonical);
          amount('Monto impuesto', tax.amount);
          if (tax.specificTax) {
            text(
              'Impuesto específico',
              `Cantidad ${tax.specificTax.quantityUnit.canonical}; unidad ${tax.specificTax.taxPerUnit.canonical}`,
            );
            if (tax.specificTax.percentage)
              text('Porcentaje específico', `${tax.specificTax.percentage.canonical}%`);
            if (tax.specificTax.proportion)
              text('Proporción específica', tax.specificTax.proportion.canonical);
            if (tax.specificTax.consumptionUnitVolume)
              text('Volumen unidad consumo', tax.specificTax.consumptionUnitVolume.canonical);
          }
          if (tax.exemption) {
            text('Exoneración', `${tax.exemption.documentType} ${tax.exemption.documentNumber}`);
            amount('Monto exoneración', tax.exemption.exemptAmount);
            text('Tarifa exonerada', `${tax.exemption.exemptRate.canonical}%`);
          }
        });
        item.bundleFields.forEach((field) => text(`Surtido ${field.elementName}`, field.value));
      };

      newPage();
      if (branding?.logoBytes?.length) {
        try {
          doc.image(branding.logoBytes, PAGE_WIDTH - MARGIN - 72, MARGIN + 10, {
            width: 64,
            height: 32,
          });
        } catch {
          this.logger.warn({ msg: 'Wave 2 branding image omitted after PDFKit decode failure' });
        }
      }
      heading('Identificación del comprobante');
      text('Tipo de comprobante', documentLabel);
      text('Clave', view.document.clave);
      text('Consecutivo', view.document.consecutive);
      text('Fecha de emisión', view.document.issueDate);
      text('Proveedor de sistemas', view.document.systemProviderId);
      text('Actividad económica emisor', view.document.issuerActivityCode);
      text('Actividad económica receptor', view.document.receiverActivityCode);
      party('Emisor', view.issuer);
      party('Receptor', view.receiver);
      heading('Venta y moneda');
      text(
        'Condición de venta',
        [view.sale.condition, view.sale.otherCondition].filter(Boolean).join(' · '),
      );
      text('Plazo de crédito', view.sale.creditTerm);
      text('Moneda', view.currency.code);
      text('Tipo de cambio', view.currency.exchangeRate.canonical);
      view.payments.forEach((payment) =>
        amount(
          `Medio de pago ${[payment.type, payment.otherType].filter(Boolean).join(' / ')}`,
          payment.total,
        ),
      );
      heading('Detalle de líneas');
      tableHeader();
      view.lines.forEach(line);
      heading('Resumen fiscal');
      amount('Monto bruto / Total venta', view.summary.gross);
      amount('Total descuentos', view.summary.discounts);
      amount('Venta neta', view.summary.net);
      amount('Total impuesto', view.summary.tax);
      view.summary.taxBreakdown.forEach((tax) =>
        amount(
          `Desglose impuesto ${[tax.code, tax.tariffCode].filter(Boolean).join(' / ')}`,
          tax.amount,
        ),
      );
      Object.entries(view.summary.values).forEach(([label, value]) => amount(label, value));
      amount('Total comprobante', view.summary.total);
      if (view.otherCharges.length) {
        heading('Otros cargos');
        view.otherCharges.forEach((charge) => {
          text('Cargo', `${charge.documentType} · ${charge.detail}`);
          text('Tercero', [charge.thirdPartyId, charge.thirdPartyName].filter(Boolean).join(' · '));
          if (charge.percentage) text('Porcentaje cargo', `${charge.percentage.canonical}%`);
          amount('Monto cargo', charge.amount);
        });
      }
      if (view.references.length) {
        heading('Referencias');
        view.references.forEach((reference) =>
          text(
            'Referencia',
            `${reference.documentType} ${reference.number} · ${reference.issuedAt} · ${reference.code} · ${reference.reason}`,
          ),
        );
      }
      if (view.otherInformation.length) {
        heading('Otra información');
        view.otherInformation.forEach((value) => text('Información', value));
      }
      const represented = new Set([
        'Clave',
        'NumeroConsecutivo',
        'FechaEmision',
        'ProveedorSistemas',
        'CodigoActividadEmisor',
        'CodigoActividadReceptor',
        'Nombre',
        'Numero',
        'CodigoMoneda',
        'TipoCambio',
        'NumeroLinea',
        'CodigoCABYS',
        'Cantidad',
        'UnidadMedida',
        'Detalle',
        'PrecioUnitario',
        'MontoTotal',
        'SubTotal',
        'MontoTotalLinea',
        'TotalComprobante',
      ]);
      const remaining = view.projectedFields.filter(
        (field) => !represented.has(field.elementName) && !field.path.includes('Signature'),
      );
      if (remaining.length) {
        heading('Datos fiscales adicionales');
        remaining.forEach((field) => text(field.elementName, field.value));
      }
      if (qrPayload) {
        ensure(QR_SIZE_PT + 20);
        QRCode.toBuffer(qrPayload, {
          type: 'png',
          width: 150,
          margin: 1,
          errorCorrectionLevel: 'M',
        })
          .then((buffer) => {
            if (settled || options.signal?.aborted) return;
            doc.image(buffer, PAGE_WIDTH - MARGIN - QR_SIZE_PT, y, {
              width: QR_SIZE_PT,
              height: QR_SIZE_PT,
            });
            doc
              .font('Helvetica')
              .fontSize(6)
              .fillColor(TEXT_GRAY)
              .text('QR configurado', PAGE_WIDTH - MARGIN - QR_SIZE_PT, y - 9, {
                width: QR_SIZE_PT,
                align: 'center',
              });
            this.finishRepresentationPdf(doc, branding, primaryColor, view.document.clave);
          })
          .catch(reject);
      } else {
        this.finishRepresentationPdf(doc, branding, primaryColor, view.document.clave);
      }
    });
  }

  private finishRepresentationPdf(
    doc: PDFKit.PDFDocument,
    branding: CompanyBrandingView | undefined,
    primaryColor: string,
    _clave: string,
  ): void {
    const pageCount = doc.bufferedPageRange().count;
    for (let index = 0; index < pageCount; index += 1) {
      doc.switchToPage(index);
      doc.rect(MARGIN, PAGE_HEIGHT - MARGIN - 3, CONTENT_WIDTH, 3).fill(primaryColor);
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(TEXT_GRAY)
        .text(
          branding?.footerText ?? 'Representación gráfica generada desde XML firmado.',
          MARGIN,
          PAGE_HEIGHT - 58,
          { width: CONTENT_WIDTH - 90, height: 12, ellipsis: true },
        );
      doc.text(
        `BILLING_DEFAULT_V1@${BILLING_DEFAULT_V1_FISCAL_REPRESENTATION_RENDERER_VERSION} · Página ${index + 1} de ${pageCount}`,
        PAGE_WIDTH - MARGIN - 180,
        PAGE_HEIGHT - 58,
        { width: 180, align: 'right', lineBreak: false },
      );
    }
    doc.end();
  }

  private safeColor(value: string | undefined): string | undefined {
    return value && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
  }

  private safeText(value: string): string {
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  }

  private validatedOptionalQr(options: FiscalRepresentationRenderOptions): string | undefined {
    if (!options.qr?.enabled) return undefined;
    if (!options.qr.payload) throw new Error('Enabled QR requires an explicit HTTPS payload.');
    let parsed: URL;
    try {
      parsed = new URL(options.qr.payload);
    } catch {
      throw new Error('Enabled QR payload must be a valid HTTPS URL.');
    }
    if (parsed.protocol !== 'https:') throw new Error('Enabled QR payload must use HTTPS.');
    return options.qr.payload;
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

    const paymentLabel = document.paymentMethod ?? 'N/A';
    doc.text(
      `Condición venta: ${document.saleCondition}  |  Medio pago: ${paymentLabel}  |  Moneda: ${document.currency}`,
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
