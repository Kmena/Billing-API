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
import { classifyCabys } from '../../domain/fiscal-cabys-classifier';

/**
 * Tax codes for which CodigoTarifaIVA is required at both line level and
 * TotalDesgloseImpuesto level, per Hacienda v4.4 documentation.
 *
 * 01 = IVA (Impuesto al Valor Agregado)
 * 07 = IVA cálculo especial
 *
 * All other CodigoImpuestoType values do NOT use CodigoTarifaIVA.
 * Source: Hacienda v4.4 "Disposiciones técnicas de los comprobantes electrónicos"
 *         CodigoTarifaIVAType definition: "Cuando se trata del IVA las tarifas y
 *         códigos a utilizar son las siguientes"
 */
const IVA_TAX_CODES = new Set(['01', '07']);

/**
 * Tax codes whose full serialization this adapter currently supports.
 * Codes not in this set are rejected early with FISCAL_XML_UNSUPPORTED_TAX_CODE
 * rather than producing fiscally incorrect XML.
 *
 * Not-yet-supported codes and their outstanding requirement:
 *   02 – Impuesto Selectivo de Consumo   (no CodigoTarifaIVA; structurally supportable)
 *   03 – Combustibles                     (requires DatosImpuestoEspecifico)
 *   04 – Bebidas alcohólicas              (requires DatosImpuestoEspecifico)
 *   05 – Bebidas sin alcohol / jabones    (requires DatosImpuestoEspecifico)
 *   06 – Tabaco                           (requires DatosImpuestoEspecifico)
 *   08 – IVA Bienes Usados                (requires FactorCalculoIVA)
 *   12 – Cemento                          (no CodigoTarifaIVA; structurally supportable)
 *   99 – Otros                            (requires CodigoImpuestoOTRO free-text field)
 */
const SUPPORTED_TAX_CODES = new Set(['01', '07']);

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

/** Aggregated summary derived from line items — single source of truth for ResumenFactura. */
interface FiscalSummaryData {
  readonly servGravados: ScaledDecimal;
  readonly servExentos: ScaledDecimal;
  readonly mercGravadas: ScaledDecimal;
  readonly mercExentas: ScaledDecimal;
  readonly totalGravado: ScaledDecimal;
  readonly totalExento: ScaledDecimal;
  readonly totalVenta: ScaledDecimal;
  readonly totalDescuentos: ScaledDecimal;
  readonly totalVentaNeta: ScaledDecimal;
  /**
   * Ordered map of tax groups. Preserves insertion order.
   *
   * Key semantics (per v4.4 contract):
   *   IVA codes (01, 07): key = "taxCode:taxRateCode"  — CodigoTarifaIVA distinguishes rates
   *   Non-IVA codes:      key = "taxCode"              — no CodigoTarifaIVA
   *
   * This matches the TotalDesgloseImpuesto grouping semantics: the XSD documentation
   * states TotalMontoImpuesto is "la sumatoria del monto por código de impuesto", but
   * CodigoTarifaIVA's presence in the structure means each (Codigo, CodigoTarifaIVA)
   * combination produces a separate element for IVA codes.
   */
  readonly taxGroups: Map<string, TaxGroupEntry>;
  readonly totalImpuesto: ScaledDecimal;
  readonly totalComprobante: ScaledDecimal;
}

interface TaxGroupEntry {
  readonly taxCode: string;
  /** Present only for IVA tax codes (01, 07). Absent for all other codes. */
  readonly taxRateCode: string | undefined;
  total: ScaledDecimal;
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
    const issuer = this.requireParty(document.issuerSnapshot, true);
    const receiver = document.receiverSnapshot
      ? this.requireParty(document.receiverSnapshot, false)
      : null;

    // Compute ResumenFactura from lines — single source of truth (never from pre-computed totals).
    const summaryData = this.computeSummary(lines);

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

    // ── ResumenFactura ────────────────────────────────────────────────────────
    // Element order follows the v4.4 XSD xs:sequence (verified against
    // TiqueteElectronico.xsd / FacturaElectronica.xsd):
    //   CodigoTipoMoneda → TotalServGravados? → TotalServExentos?
    //   → TotalMercanciasGravadas? → TotalMercanciasExentas?
    //   → TotalGravado? → TotalExento? → TotalVenta → TotalVentaNeta
    //   → TotalDesgloseImpuesto* → TotalImpuesto? → MedioPago? → TotalComprobante
    const summary = root.ele('ResumenFactura');

    const currency = summary.ele('CodigoTipoMoneda');
    currency.ele('CodigoMoneda').txt(document.currency).up();
    currency
      .ele('TipoCambio')
      .txt(this.decimal(document.exchangeRate?.toString() ?? '1'))
      .up();
    currency.up();

    if (!summaryData.servGravados.isZero()) {
      summary.ele('TotalServGravados').txt(this.decimal(summaryData.servGravados.toString())).up();
    }
    if (!summaryData.servExentos.isZero()) {
      summary.ele('TotalServExentos').txt(this.decimal(summaryData.servExentos.toString())).up();
    }
    if (!summaryData.mercGravadas.isZero()) {
      summary
        .ele('TotalMercanciasGravadas')
        .txt(this.decimal(summaryData.mercGravadas.toString()))
        .up();
    }
    if (!summaryData.mercExentas.isZero()) {
      summary
        .ele('TotalMercanciasExentas')
        .txt(this.decimal(summaryData.mercExentas.toString()))
        .up();
    }
    if (!summaryData.totalGravado.isZero()) {
      summary.ele('TotalGravado').txt(this.decimal(summaryData.totalGravado.toString())).up();
    }
    if (!summaryData.totalExento.isZero()) {
      summary.ele('TotalExento').txt(this.decimal(summaryData.totalExento.toString())).up();
    }

    summary.ele('TotalVenta').txt(this.decimal(summaryData.totalVenta.toString())).up();
    summary.ele('TotalVentaNeta').txt(this.decimal(summaryData.totalVentaNeta.toString())).up();

    // TotalDesgloseImpuesto — one element per tax group.
    // Per XSD xs:sequence: BEFORE TotalImpuesto.
    //
    // CodigoTarifaIVA conditionality (v4.4 contract):
    //   Codes 01, 07 (IVA): CodigoTarifaIVA REQUIRED — grouping key is (Codigo, CodigoTarifaIVA).
    //   All other codes:    CodigoTarifaIVA ABSENT   — grouping key is Codigo alone.
    for (const group of summaryData.taxGroups.values()) {
      const desglose = summary.ele('TotalDesgloseImpuesto');
      desglose.ele('Codigo').txt(group.taxCode).up();
      if (group.taxRateCode !== undefined) {
        desglose.ele('CodigoTarifaIVA').txt(group.taxRateCode).up();
      }
      desglose.ele('TotalMontoImpuesto').txt(this.decimal(group.total.toString())).up();
      desglose.up();
    }

    if (!summaryData.totalImpuesto.isZero()) {
      summary.ele('TotalImpuesto').txt(this.decimal(summaryData.totalImpuesto.toString())).up();
    }

    const payment = summary.ele('MedioPago');
    payment.ele('TipoMedioPago').txt(document.paymentMethod).up();
    payment.ele('TotalMedioPago').txt(this.decimal(summaryData.totalComprobante.toString())).up();
    payment.up();

    summary.ele('TotalComprobante').txt(this.decimal(summaryData.totalComprobante.toString())).up();
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

  /**
   * Derives all ResumenFactura totals from line items.
   *
   * CAByS first-digit rule (per Hacienda v4.4 taxonomy):
   *   0–4 → goods  (TotalMercanciasGravadas / TotalMercanciasExentas)
   *   5–9 → service (TotalServGravados / TotalServExentos)
   *
   * All arithmetic is performed with ScaledDecimal (bigint-backed, 5 decimal
   * places) — no floating point involved.
   */
  private computeSummary(lines: FiscalXmlLineSnapshot[]): FiscalSummaryData {
    let servGravados = ScaledDecimal.zero();
    let servExentos = ScaledDecimal.zero();
    let mercGravadas = ScaledDecimal.zero();
    let mercExentas = ScaledDecimal.zero();
    let totalDescuentos = ScaledDecimal.zero();
    let totalImpuesto = ScaledDecimal.zero();
    const taxGroups = new Map<string, TaxGroupEntry>();

    for (const line of lines) {
      const gross = ScaledDecimal.from(line.quantity).multiply(ScaledDecimal.from(line.unitPrice));
      const discount = ScaledDecimal.from(line.discountAmount ?? '0');
      const tax = ScaledDecimal.from(line.taxAmount ?? '0');
      const subtotal = gross.subtract(discount);

      totalDescuentos = totalDescuentos.add(discount);

      const category = classifyCabys(line.cabysCode);
      const hasTax = !tax.isZero();

      if (hasTax) {
        if (category === 'SERVICE') {
          servGravados = servGravados.add(subtotal);
        } else {
          mercGravadas = mercGravadas.add(subtotal);
        }
        totalImpuesto = totalImpuesto.add(tax);

        if (!line.taxCode) {
          // appendLine will throw FISCAL_XML_TAX_METADATA_REQUIRED.
          // Skip group aggregation — serialization cannot complete.
          continue;
        }
        if (!SUPPORTED_TAX_CODES.has(line.taxCode)) {
          // appendLine will throw FISCAL_XML_UNSUPPORTED_TAX_CODE.
          // Skip group aggregation — serialization cannot complete.
          continue;
        }

        const isIvaTax = IVA_TAX_CODES.has(line.taxCode);

        if (isIvaTax && !line.taxRateCode) {
          // appendLine will throw FISCAL_XML_IVA_RATE_CODE_REQUIRED.
          // Skip group aggregation — serialization cannot complete.
          continue;
        }

        // IVA codes (01, 07): group key distinguishes each (Codigo, CodigoTarifaIVA) pair.
        // Non-IVA codes:      group key is Codigo alone (no CodigoTarifaIVA semantics).
        const key = isIvaTax ? `${line.taxCode}:${line.taxRateCode}` : line.taxCode;
        const taxRateCode = isIvaTax ? line.taxRateCode : undefined;

        const existing = taxGroups.get(key);
        if (existing) {
          existing.total = existing.total.add(tax);
        } else {
          taxGroups.set(key, { taxCode: line.taxCode, taxRateCode, total: tax });
        }
      } else {
        if (category === 'SERVICE') {
          servExentos = servExentos.add(subtotal);
        } else {
          mercExentas = mercExentas.add(subtotal);
        }
      }
    }

    const totalGravado = servGravados.add(mercGravadas);
    const totalExento = servExentos.add(mercExentas);
    const totalVenta = totalGravado.add(totalExento);
    const totalVentaNeta = totalVenta.subtract(totalDescuentos);
    const totalComprobante = totalVentaNeta.add(totalImpuesto);

    return {
      servGravados,
      servExentos,
      mercGravadas,
      mercExentas,
      totalGravado,
      totalExento,
      totalVenta,
      totalDescuentos,
      totalVentaNeta,
      taxGroups,
      totalImpuesto,
      totalComprobante,
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
    if (!discount.isZero()) {
      throw new Error('FISCAL_XML_UNSUPPORTED_CONDITIONAL:discount');
    }
    node.ele('SubTotal').txt(this.decimal(subtotal.toString())).up();
    if (!tax.isZero()) {
      if (!line.taxCode) {
        throw new Error('FISCAL_XML_TAX_METADATA_REQUIRED');
      }
      if (!SUPPORTED_TAX_CODES.has(line.taxCode)) {
        // Fail closed: produce no XML rather than incorrect XML.
        // See SUPPORTED_TAX_CODES definition for what each code requires.
        throw new Error(`FISCAL_XML_UNSUPPORTED_TAX_CODE:${line.taxCode}`);
      }
      const isIvaTax = IVA_TAX_CODES.has(line.taxCode);
      if (isIvaTax && (!line.taxRateCode || !line.taxRate)) {
        // IVA codes (01, 07) require CodigoTarifaIVA and Tarifa.
        throw new Error('FISCAL_XML_IVA_RATE_CODE_REQUIRED');
      }
      node.ele('BaseImponible').txt(this.decimal(subtotal.toString())).up();
      const taxNode = node.ele('Impuesto');
      taxNode.ele('Codigo').txt(line.taxCode).up();
      // CodigoTarifaIVA is ONLY emitted for IVA codes (01, 07).
      // Emitting it for non-IVA codes would violate the v4.4 contract.
      if (isIvaTax) {
        taxNode.ele('CodigoTarifaIVA').txt(line.taxRateCode!).up();
        taxNode.ele('Tarifa').txt(this.decimal(line.taxRate!)).up();
      }
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
          // proveedorSistemas is intentionally absent: the XSD element is required but allows
          // empty content (maxLength=20, no minLength). An absent/null value serializes as
          // <ProveedorSistemas/> which satisfies the XSD restriction.
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
