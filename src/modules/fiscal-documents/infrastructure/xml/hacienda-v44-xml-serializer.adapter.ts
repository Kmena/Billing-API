import { Injectable } from '@nestjs/common';
import { create } from 'xmlbuilder2';
import { FiscalXmlSerializerPort } from '../../application/fiscal-xml/fiscal-xml-serializer.port';
import {
  HACIENDA_V44_FACTURA_ELECTRONICA,
  HACIENDA_V44_SCHEMA_VERSION,
  HACIENDA_V44_TIQUETE_ELECTRONICO,
} from '../../domain/fiscal-xml/hacienda-v44-contract';
import {
  FiscalXmlDocumentSnapshot,
  FiscalXmlGenerationResult,
} from '../../domain/fiscal-xml/fiscal-xml.types';
import { mapIdentificationTypeToXmlCode } from '../../domain/fiscal-identification.mapper';
import { ScaledDecimal } from '../../domain/scaled-decimal';

interface FiscalXmlLineSnapshot {
  readonly lineNumber: number;
  readonly cabysCode: string;
  readonly description: string;
  readonly unitMeasure: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discountAmount?: string;
  readonly taxAmount?: string;
  readonly taxCode?: string;
  readonly taxRateCode?: string;
  readonly taxRate?: string;
}

interface FiscalXmlTotalsSnapshot {
  readonly grossAmount: string;
  readonly discountAmount: string;
  readonly taxAmount: string;
  readonly totalAmount: string;
}

@Injectable()
export class HaciendaV44XmlSerializerAdapter implements FiscalXmlSerializerPort {
  serialize(document: FiscalXmlDocumentSnapshot): FiscalXmlGenerationResult {
    const contract =
      document.type === 'INVOICE'
        ? HACIENDA_V44_FACTURA_ELECTRONICA
        : HACIENDA_V44_TIQUETE_ELECTRONICO;
    this.assertSupportedCatalog('currency', document.currency, ['CRC', 'USD']);
    this.assertSupportedCatalog('saleCondition', document.saleCondition, [
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '10',
      '12',
      '13',
      '14',
      '15',
      '99',
    ]);
    this.assertSupportedCatalog('paymentMethod', document.paymentMethod, [
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '99',
    ]);

    const lines = this.requireLines(document.lines);
    const totals = this.requireTotals(document.totals);
    const issuer = this.requireParty(document.issuerSnapshot, true);
    const receiver = document.receiverSnapshot
      ? this.requireParty(document.receiverSnapshot, false)
      : null;

    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(contract.rootElement, {
      xmlns: contract.namespace,
      'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
    });

    root.ele('Clave').txt(document.clave).up();
    root.ele('ProveedorSistemas').txt(issuer.proveedorSistemas).up();
    root.ele('CodigoActividadEmisor').txt(issuer.codigoActividad).up();
    root.ele('NumeroConsecutivo').txt(document.consecutive).up();
    root.ele('FechaEmision').txt(this.formatDate(document.issueDate)).up();
    this.appendParty(root, 'Emisor', issuer, true);
    if (receiver) this.appendParty(root, 'Receptor', receiver, false);
    root.ele('CondicionVenta').txt(document.saleCondition).up();
    const creditTerm = this.optionalText(document.issuerSnapshot.plazoCredito, '');
    if (document.saleCondition === '02' && creditTerm)
      root.ele('PlazoCredito').txt(creditTerm).up();

    const detail = root.ele('DetalleServicio');
    for (const line of lines) {
      this.assertSupportedCatalog('unitMeasure', line.unitMeasure, ['Sp', 'Unid']);
      this.appendLine(detail, line);
    }
    detail.up();

    const summary = root.ele('ResumenFactura');
    const currency = summary.ele('CodigoTipoMoneda');
    currency.ele('CodigoMoneda').txt(document.currency).up();
    currency
      .ele('TipoCambio')
      .txt(this.decimal(document.exchangeRate?.toString() ?? '1'))
      .up();
    currency.up();
    summary.ele('TotalServGravados').txt(this.decimal(totals.grossAmount)).up();
    summary.ele('TotalGravado').txt(this.decimal(totals.grossAmount)).up();
    summary.ele('TotalVenta').txt(this.decimal(totals.grossAmount)).up();
    if (ScaledDecimal.from(totals.discountAmount).toString() !== '0.00000') {
      throw new Error('FISCAL_XML_UNSUPPORTED_CONDITIONAL:discount');
    }
    summary.ele('TotalDescuentos').txt(this.decimal(totals.discountAmount)).up();
    summary
      .ele('TotalVentaNeta')
      .txt(
        this.decimal(
          ScaledDecimal.from(totals.grossAmount)
            .subtract(ScaledDecimal.from(totals.discountAmount))
            .toString(),
        ),
      )
      .up();
    if (ScaledDecimal.from(totals.taxAmount).toString() !== '0.00000') {
      summary.ele('TotalImpuesto').txt(this.decimal(totals.taxAmount)).up();
    }
    const payment = summary.ele('MedioPago');
    payment.ele('TipoMedioPago').txt(document.paymentMethod).up();
    payment.ele('TotalMedioPago').txt(this.decimal(totals.totalAmount)).up();
    payment.up();
    summary.ele('TotalComprobante').txt(this.decimal(totals.totalAmount)).up();
    summary.up();

    const xml = root.end({ prettyPrint: false, headless: false });
    return {
      documentType: document.type,
      rootElement: contract.rootElement,
      namespace: contract.namespace,
      schemaVersion: HACIENDA_V44_SCHEMA_VERSION,
      xml,
    };
  }

  private appendParty(
    parent: XMLBuilderNode,
    elementName: 'Emisor' | 'Receptor',
    party: Record<string, string>,
    requireXmlAddress: boolean,
  ): void {
    const node = parent.ele(elementName);
    node
      .ele('Nombre')
      .txt(party.legalName ?? party.name)
      .up();
    const identification = node.ele('Identificacion');
    identification
      .ele('Tipo')
      .txt(this.identificationTypeCode(party.identificationType ?? '02'))
      .up();
    identification.ele('Numero').txt(party.identificationNumber).up();
    identification.up();
    if (party.tradeName) node.ele('NombreComercial').txt(party.tradeName).up();
    if (requireXmlAddress || party.provincia) {
      const location = node.ele('Ubicacion');
      location.ele('Provincia').txt(party.provincia).up();
      location.ele('Canton').txt(party.canton).up();
      location.ele('Distrito').txt(party.distrito).up();
      if (party.barrio) location.ele('Barrio').txt(party.barrio).up();
      location.ele('OtrasSenas').txt(party.otrasSenas).up();
      location.up();
    }
    if (party.email) node.ele('CorreoElectronico').txt(party.email).up();
    node.up();
  }

  private appendLine(parent: XMLBuilderNode, line: FiscalXmlLineSnapshot): void {
    const quantity = ScaledDecimal.from(line.quantity);
    const unitPrice = ScaledDecimal.from(line.unitPrice);
    const gross = quantity.multiply(unitPrice);
    const discount = ScaledDecimal.from(line.discountAmount ?? '0');
    const tax = ScaledDecimal.from(line.taxAmount ?? '0');
    const subtotal = gross.subtract(discount);
    const total = subtotal.add(tax);

    const node = parent.ele('LineaDetalle');
    node.ele('NumeroLinea').txt(String(line.lineNumber)).up();
    node.ele('CodigoCABYS').txt(line.cabysCode).up();
    node.ele('Cantidad').txt(this.quantityDecimal(line.quantity)).up();
    node.ele('UnidadMedida').txt(line.unitMeasure).up();
    node.ele('Detalle').txt(line.description).up();
    node.ele('PrecioUnitario').txt(this.decimal(line.unitPrice)).up();
    node.ele('MontoTotal').txt(this.decimal(gross.toString())).up();
    if (discount.toString() !== '0.00000') {
      throw new Error('FISCAL_XML_UNSUPPORTED_CONDITIONAL:discount');
    }
    node.ele('SubTotal').txt(this.decimal(subtotal.toString())).up();
    if (tax.toString() !== '0.00000') {
      if (!line.taxCode || !line.taxRateCode || !line.taxRate) {
        throw new Error('FISCAL_XML_TAX_METADATA_REQUIRED');
      }
      node.ele('BaseImponible').txt(this.decimal(subtotal.toString())).up();
      const taxNode = node.ele('Impuesto');
      taxNode.ele('Codigo').txt(line.taxCode).up();
      taxNode.ele('CodigoTarifaIVA').txt(line.taxRateCode).up();
      taxNode.ele('Tarifa').txt(this.decimal(line.taxRate)).up();
      taxNode.ele('Monto').txt(this.decimal(tax.toString())).up();
      taxNode.up();
      node.ele('ImpuestoAsumidoEmisorFabrica').txt(this.decimal('0')).up();
      node.ele('ImpuestoNeto').txt(this.decimal(tax.toString())).up();
    }
    node.ele('MontoTotalLinea').txt(this.decimal(total.toString())).up();
    node.up();
  }

  private requireLines(lines: unknown): FiscalXmlLineSnapshot[] {
    if (!Array.isArray(lines) || lines.length === 0) throw new Error('FISCAL_XML_LINES_REQUIRED');
    return lines as FiscalXmlLineSnapshot[];
  }

  private requireTotals(totals: unknown): FiscalXmlTotalsSnapshot {
    if (!totals || typeof totals !== 'object') throw new Error('FISCAL_XML_TOTALS_REQUIRED');
    return totals as FiscalXmlTotalsSnapshot;
  }

  private requireParty(
    party: Record<string, unknown>,
    requireXmlAddress: boolean,
  ): Record<string, string> {
    const normalized = Object.fromEntries(
      Object.entries(party).map(([key, value]) => [key, value?.toString() ?? '']),
    );
    const required = requireXmlAddress
      ? [
          'legalName',
          'identificationType',
          'identificationNumber',
          'provincia',
          'canton',
          'distrito',
          'otrasSenas',
          'email',
          'codigoActividad',
          'proveedorSistemas',
        ]
      : ['name', 'identificationNumber'];
    for (const field of required) {
      if (!normalized[field]) throw new Error(`FISCAL_XML_PARTY_FIELD_REQUIRED:${field}`);
    }
    return normalized;
  }

  private optionalText(value: unknown, fallback: string): string {
    return value?.toString() || fallback;
  }

  private decimal(value: string): string {
    return ScaledDecimal.from(value).toString();
  }

  private quantityDecimal(value: string): string {
    const [integerPart, fractionalPart = ''] = ScaledDecimal.from(value).toString().split('.');
    return `${integerPart}.${fractionalPart.slice(0, 3).padEnd(3, '0')}`;
  }

  private identificationTypeCode(value: string): string {
    try {
      return mapIdentificationTypeToXmlCode(value);
    } catch {
      throw new Error('FISCAL_XML_UNSUPPORTED_CATALOG:identificationType');
    }
  }

  private assertSupportedCatalog(field: string, value: string, supportedValues: string[]): void {
    if (!supportedValues.includes(value)) {
      throw new Error(`FISCAL_XML_UNSUPPORTED_CATALOG:${field}`);
    }
  }

  private formatDate(value: Date): string {
    const costaRicaOffsetMinutes = -6 * 60;
    const costaRicaTime = new Date(value.getTime() + costaRicaOffsetMinutes * 60_000);
    return `${costaRicaTime.getUTCFullYear()}-${this.pad(costaRicaTime.getUTCMonth() + 1)}-${this.pad(
      costaRicaTime.getUTCDate(),
    )}T${this.pad(costaRicaTime.getUTCHours())}:${this.pad(
      costaRicaTime.getUTCMinutes(),
    )}:${this.pad(costaRicaTime.getUTCSeconds())}-06:00`;
  }

  private pad(value: number): string {
    return value.toString().padStart(2, '0');
  }
}

type XMLBuilderNode = ReturnType<ReturnType<typeof create>['ele']>;
