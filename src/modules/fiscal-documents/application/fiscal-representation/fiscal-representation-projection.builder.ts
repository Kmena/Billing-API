import { Element } from '@xmldom/xmldom';
import {
  FiscalDecimal,
  FiscalDiscountView,
  FiscalDocumentType,
  FiscalExemptionView,
  FiscalLineView,
  FiscalOtherChargeView,
  FiscalPartyView,
  FiscalPaymentView,
  FiscalProjectedField,
  FiscalReferenceView,
  FiscalRepresentationView,
  FiscalSpecificTaxView,
  FiscalSummaryField,
  FiscalTaxView,
  FiscalXmlProjectionError,
} from './read-only-fiscal-xml-parser';

const SUMMARY_FIELDS: readonly FiscalSummaryField[] = [
  'TotalServGravados',
  'TotalServExentos',
  'TotalServExonerado',
  'TotalServNoSujeto',
  'TotalMercanciasGravadas',
  'TotalMercanciasExentas',
  'TotalMercExonerada',
  'TotalMercNoSujeta',
  'TotalGravado',
  'TotalExento',
  'TotalExonerado',
  'TotalNoSujeto',
  'TotalVenta',
  'TotalDescuentos',
  'TotalVentaNeta',
  'TotalImpuesto',
  'TotalImpAsumEmisorFabrica',
  'TotalIVADevuelto',
  'TotalOtrosCargos',
  'TotalComprobante',
] as const;

export class FiscalRepresentationProjectionBuilder {
  build(
    root: Element,
    documentType: FiscalDocumentType,
    signedXmlSha256: string,
  ): FiscalRepresentationView {
    const summaryElement = this.element(root, 'ResumenFactura', true)!;
    const currencyElement = this.element(summaryElement, 'CodigoTipoMoneda', true)!;
    const issuer = this.party(root, 'Emisor', true)!;
    if (!issuer.legalName)
      throw this.projectionFailure('/Root/Emisor/Nombre', 'required value is absent');

    const summaryValues: Partial<Record<FiscalSummaryField, FiscalDecimal>> = {};
    for (const field of SUMMARY_FIELDS) {
      const value = this.text(summaryElement, field);
      if (value !== undefined)
        summaryValues[field] = this.decimal(value, `/Root/ResumenFactura/${field}`);
    }

    const linesContainer = this.element(root, 'DetalleServicio');
    const lines = linesContainer
      ? this.elements(linesContainer, 'LineaDetalle').map((line) => this.line(line, documentType))
      : [];

    return Object.freeze({
      contractVersion: '1.0',
      source: Object.freeze({
        signedXmlSha256,
        schemaNamespace: root.namespaceURI!,
        documentType,
      }),
      document: Object.freeze({
        type: documentType,
        clave: this.requiredText(root, 'Clave', '/Root/Clave'),
        systemProviderId: this.requiredTextAllowEmpty(
          root,
          'ProveedorSistemas',
          '/Root/ProveedorSistemas',
          20,
        ),
        issuerActivityCode: this.requiredText(
          root,
          'CodigoActividadEmisor',
          '/Root/CodigoActividadEmisor',
        ),
        receiverActivityCode:
          documentType === 'INVOICE' ? this.text(root, 'CodigoActividadReceptor') : undefined,
        consecutive: this.requiredText(root, 'NumeroConsecutivo', '/Root/NumeroConsecutivo'),
        issueDate: this.requiredText(root, 'FechaEmision', '/Root/FechaEmision'),
      }),
      issuer: Object.freeze({
        ...issuer,
        legalName: issuer.legalName,
        economicActivity: this.requiredText(
          root,
          'CodigoActividadEmisor',
          '/Root/CodigoActividadEmisor',
        ),
      }),
      receiver: this.receiver(root, documentType),
      sale: Object.freeze({
        condition: this.requiredText(root, 'CondicionVenta', '/Root/CondicionVenta'),
        otherCondition: this.text(root, 'CondicionVentaOtros'),
        creditTerm: this.text(root, 'PlazoCredito'),
      }),
      currency: Object.freeze({
        code: this.requiredText(
          currencyElement,
          'CodigoMoneda',
          '/Root/ResumenFactura/CodigoTipoMoneda/CodigoMoneda',
        ),
        exchangeRate: this.decimal(
          this.requiredText(
            currencyElement,
            'TipoCambio',
            '/Root/ResumenFactura/CodigoTipoMoneda/TipoCambio',
          ),
          '/Root/ResumenFactura/CodigoTipoMoneda/TipoCambio',
        ),
      }),
      payments: Object.freeze(this.payments(summaryElement)),
      lines: Object.freeze(lines),
      summary: Object.freeze({
        gross: this.requiredSummary(summaryValues, 'TotalVenta'),
        discounts: summaryValues.TotalDescuentos,
        net: this.requiredSummary(summaryValues, 'TotalVentaNeta'),
        tax: summaryValues.TotalImpuesto,
        total: this.requiredSummary(summaryValues, 'TotalComprobante'),
        values: Object.freeze(summaryValues),
        taxBreakdown: Object.freeze(
          this.elements(summaryElement, 'TotalDesgloseImpuesto').map((item) =>
            Object.freeze({
              code: this.requiredText(item, 'Codigo', 'TotalDesgloseImpuesto/Codigo'),
              tariffCode: this.text(item, 'CodigoTarifaIVA'),
              amount: this.decimal(
                this.requiredText(
                  item,
                  'TotalMontoImpuesto',
                  'TotalDesgloseImpuesto/TotalMontoImpuesto',
                ),
                'TotalDesgloseImpuesto/TotalMontoImpuesto',
              ),
            }),
          ),
        ),
      }),
      otherCharges: Object.freeze(
        this.elements(root, 'OtrosCargos').map((charge) => this.otherCharge(charge)),
      ),
      references: Object.freeze(
        this.elements(root, 'InformacionReferencia').map((reference) => this.reference(reference)),
      ),
      otherInformation: Object.freeze(
        this.element(root, 'Otros')
          ? this.elements(this.element(root, 'Otros')!, 'OtroTexto').map(
              (item) => item.textContent?.trim() ?? '',
            )
          : [],
      ),
      projectedFields: Object.freeze(this.collectLeafFields(root)),
    });
  }

  private line(line: Element, documentType: FiscalDocumentType): FiscalLineView {
    const path = '/Root/DetalleServicio/LineaDetalle';
    const bundle = this.element(line, 'DetalleSurtido');
    return Object.freeze({
      number: this.requiredText(line, 'NumeroLinea', `${path}/NumeroLinea`),
      cabys: this.requiredText(line, 'CodigoCABYS', `${path}/CodigoCABYS`),
      commercialCodes: Object.freeze(
        this.elements(line, 'CodigoComercial').map((code) =>
          Object.freeze({
            type: this.requiredText(code, 'Tipo', `${path}/CodigoComercial/Tipo`),
            code: this.requiredText(code, 'Codigo', `${path}/CodigoComercial/Codigo`),
          }),
        ),
      ),
      quantity: this.decimal(
        this.requiredText(line, 'Cantidad', `${path}/Cantidad`),
        `${path}/Cantidad`,
      ),
      unit: this.requiredText(line, 'UnidadMedida', `${path}/UnidadMedida`),
      commercialUnit: this.text(line, 'UnidadMedidaComercial'),
      transactionType: documentType === 'INVOICE' ? this.text(line, 'TipoTransaccion') : undefined,
      detail: this.requiredText(line, 'Detalle', `${path}/Detalle`),
      vinOrSerialNumbers: Object.freeze(
        this.elements(line, 'NumeroVINoSerie').map((item) => item.textContent?.trim() ?? ''),
      ),
      medicationRegistration: this.text(line, 'RegistroMedicamento'),
      pharmaceuticalForm: this.text(line, 'FormaFarmaceutica'),
      unitPrice: this.decimal(
        this.requiredText(line, 'PrecioUnitario', `${path}/PrecioUnitario`),
        `${path}/PrecioUnitario`,
      ),
      total: this.decimal(
        this.requiredText(line, 'MontoTotal', `${path}/MontoTotal`),
        `${path}/MontoTotal`,
      ),
      discounts: Object.freeze(
        this.elements(line, 'Descuento').map((discount) => this.discount(discount)),
      ),
      subtotal: this.decimal(
        this.requiredText(line, 'SubTotal', `${path}/SubTotal`),
        `${path}/SubTotal`,
      ),
      vatCollectedAtFactory: this.text(line, 'IVACobradoFabrica'),
      taxableBase: this.optionalDecimal(line, 'BaseImponible', `${path}/BaseImponible`),
      taxes: Object.freeze(this.elements(line, 'Impuesto').map((tax) => this.tax(tax))),
      issuerAssumedFactoryTax: this.optionalDecimal(
        line,
        'ImpuestoAsumidoEmisorFabrica',
        `${path}/ImpuestoAsumidoEmisorFabrica`,
      ),
      taxNet: this.decimal(
        this.requiredText(line, 'ImpuestoNeto', `${path}/ImpuestoNeto`),
        `${path}/ImpuestoNeto`,
      ),
      lineTotal: this.decimal(
        this.requiredText(line, 'MontoTotalLinea', `${path}/MontoTotalLinea`),
        `${path}/MontoTotalLinea`,
      ),
      bundleFields: Object.freeze(bundle ? this.collectLeafFields(bundle) : []),
    });
  }

  private tax(tax: Element): FiscalTaxView {
    const specific = this.element(tax, 'DatosImpuestoEspecifico');
    const exemption = this.element(tax, 'Exoneracion');
    return Object.freeze({
      code: this.requiredText(tax, 'Codigo', 'Impuesto/Codigo'),
      otherCode: this.text(tax, 'CodigoImpuestoOTRO'),
      tariffCode: this.text(tax, 'CodigoTarifaIVA'),
      rate: this.optionalDecimal(tax, 'Tarifa', 'Impuesto/Tarifa'),
      vatCalculationFactor: this.optionalDecimal(
        tax,
        'FactorCalculoIVA',
        'Impuesto/FactorCalculoIVA',
      ),
      specificTax: specific ? this.specificTax(specific) : undefined,
      amount: this.decimal(this.requiredText(tax, 'Monto', 'Impuesto/Monto'), 'Impuesto/Monto'),
      exemption: exemption ? this.exemption(exemption) : undefined,
    });
  }

  private specificTax(value: Element): FiscalSpecificTaxView {
    return Object.freeze({
      quantityUnit: this.decimal(
        this.requiredText(
          value,
          'CantidadUnidadMedida',
          'DatosImpuestoEspecifico/CantidadUnidadMedida',
        ),
        'DatosImpuestoEspecifico/CantidadUnidadMedida',
      ),
      percentage: this.optionalDecimal(value, 'Porcentaje', 'DatosImpuestoEspecifico/Porcentaje'),
      proportion: this.optionalDecimal(value, 'Proporcion', 'DatosImpuestoEspecifico/Proporcion'),
      consumptionUnitVolume: this.optionalDecimal(
        value,
        'VolumenUnidadConsumo',
        'DatosImpuestoEspecifico/VolumenUnidadConsumo',
      ),
      taxPerUnit: this.decimal(
        this.requiredText(value, 'ImpuestoUnidad', 'DatosImpuestoEspecifico/ImpuestoUnidad'),
        'DatosImpuestoEspecifico/ImpuestoUnidad',
      ),
    });
  }

  private exemption(value: Element): FiscalExemptionView {
    return Object.freeze({
      documentType: this.requiredText(value, 'TipoDocumentoEX1', 'Exoneracion/TipoDocumentoEX1'),
      otherDocumentType: this.text(value, 'TipoDocumentoOTRO'),
      documentNumber: this.requiredText(value, 'NumeroDocumento', 'Exoneracion/NumeroDocumento'),
      article: this.text(value, 'Articulo'),
      clause: this.text(value, 'Inciso'),
      institutionName: this.requiredText(
        value,
        'NombreInstitucion',
        'Exoneracion/NombreInstitucion',
      ),
      otherInstitutionName: this.text(value, 'NombreInstitucionOtros'),
      issuedAt: this.requiredText(value, 'FechaEmisionEX', 'Exoneracion/FechaEmisionEX'),
      exemptRate: this.decimal(
        this.requiredText(value, 'TarifaExonerada', 'Exoneracion/TarifaExonerada'),
        'Exoneracion/TarifaExonerada',
      ),
      exemptAmount: this.decimal(
        this.requiredText(value, 'MontoExoneracion', 'Exoneracion/MontoExoneracion'),
        'Exoneracion/MontoExoneracion',
      ),
    });
  }

  private discount(value: Element): FiscalDiscountView {
    return Object.freeze({
      amount: this.decimal(
        this.requiredText(value, 'MontoDescuento', 'Descuento/MontoDescuento'),
        'Descuento/MontoDescuento',
      ),
      code: this.requiredText(value, 'CodigoDescuento', 'Descuento/CodigoDescuento'),
      otherCode: this.text(value, 'CodigoDescuentoOTRO'),
      nature: this.text(value, 'NaturalezaDescuento'),
    });
  }

  private payments(summary: Element): FiscalPaymentView[] {
    return this.elements(summary, 'MedioPago').map((payment) =>
      Object.freeze({
        type: this.requiredText(payment, 'TipoMedioPago', 'MedioPago/TipoMedioPago'),
        otherType: this.text(payment, 'MedioPagoOtros'),
        total: this.decimal(
          this.requiredText(payment, 'TotalMedioPago', 'MedioPago/TotalMedioPago'),
          'MedioPago/TotalMedioPago',
        ),
      }),
    );
  }

  private otherCharge(value: Element): FiscalOtherChargeView {
    return Object.freeze({
      documentType: this.requiredText(value, 'TipoDocumentoOC', 'OtrosCargos/TipoDocumentoOC'),
      otherDocumentType: this.text(value, 'TipoDocumentoOTROS'),
      thirdPartyId: this.text(value, 'IdentificacionTercero'),
      thirdPartyName: this.text(value, 'NombreTercero'),
      detail: this.requiredText(value, 'Detalle', 'OtrosCargos/Detalle'),
      percentage: this.optionalDecimal(value, 'PorcentajeOC', 'OtrosCargos/PorcentajeOC'),
      amount: this.decimal(
        this.requiredText(value, 'MontoCargo', 'OtrosCargos/MontoCargo'),
        'OtrosCargos/MontoCargo',
      ),
    });
  }

  private reference(value: Element): FiscalReferenceView {
    return Object.freeze({
      documentType: this.requiredText(value, 'TipoDocIR', 'InformacionReferencia/TipoDocIR'),
      otherDocumentType: this.text(value, 'TipoDocRefOTRO'),
      number: this.requiredText(value, 'Numero', 'InformacionReferencia/Numero'),
      issuedAt: this.requiredText(value, 'FechaEmisionIR', 'InformacionReferencia/FechaEmisionIR'),
      code: this.requiredText(value, 'Codigo', 'InformacionReferencia/Codigo'),
      otherCode: this.text(value, 'CodigoReferenciaOTRO'),
      reason: this.requiredText(value, 'Razon', 'InformacionReferencia/Razon'),
    });
  }

  private receiver(root: Element, documentType: FiscalDocumentType): FiscalPartyView | undefined {
    const receiver = this.party(root, 'Receptor', documentType === 'INVOICE');
    if (!receiver) return undefined;
    return Object.freeze({
      ...receiver,
      economicActivity:
        documentType === 'INVOICE' ? this.text(root, 'CodigoActividadReceptor') : undefined,
    });
  }

  private party(root: Element, name: string, required: boolean): FiscalPartyView | undefined {
    const party = this.element(root, name, required);
    if (!party) return undefined;
    const identification = this.element(party, 'Identificacion');
    const location = this.element(party, 'Ubicacion');
    const phone = this.element(party, 'Telefono');
    return Object.freeze({
      legalName: this.text(party, 'Nombre'),
      commercialName: this.text(party, 'NombreComercial'),
      identification: identification
        ? Object.freeze({
            type: this.text(identification, 'Tipo'),
            number: this.text(identification, 'Numero'),
          })
        : undefined,
      foreignIdentification: this.text(party, 'IdentificacionExtranjero'),
      fiscalRegistry8707: this.text(party, 'Registrofiscal8707'),
      location: location
        ? Object.freeze({
            province: this.text(location, 'Provincia'),
            canton: this.text(location, 'Canton'),
            district: this.text(location, 'Distrito'),
            neighborhood: this.text(location, 'Barrio'),
            otherSigns: this.text(location, 'OtrasSenas'),
            foreignOtherSigns: this.text(location, 'OtrasSenasExtranjero'),
          })
        : undefined,
      phone: phone
        ? Object.freeze({
            countryCode: this.requiredText(phone, 'CodigoPais', `${name}/Telefono/CodigoPais`),
            number: this.requiredText(phone, 'NumTelefono', `${name}/Telefono/NumTelefono`),
          })
        : undefined,
      email: this.text(party, 'CorreoElectronico'),
    });
  }

  private collectLeafFields(root: Element): FiscalProjectedField[] {
    const result: FiscalProjectedField[] = [];
    const stack: Array<{ element: Element; path: string }> = [
      { element: root, path: `/${root.localName}` },
    ];
    let order = 0;
    while (stack.length) {
      const current = stack.pop()!;
      const children = Array.from(current.element.childNodes).filter(
        (node): node is Element => node.nodeType === 1,
      );
      if (children.length === 0) {
        result.push(
          Object.freeze({
            path: current.path,
            elementName: current.element.localName ?? current.element.nodeName,
            value: current.element.textContent?.trim() ?? '',
            order: order++,
          }),
        );
      } else {
        for (let index = children.length - 1; index >= 0; index -= 1) {
          const child = children[index];
          stack.push({ element: child, path: `${current.path}/${child.localName}` });
        }
      }
    }
    return result;
  }

  private requiredSummary(
    values: Partial<Record<FiscalSummaryField, FiscalDecimal>>,
    field: FiscalSummaryField,
  ): FiscalDecimal {
    const value = values[field];
    if (!value)
      throw this.projectionFailure(`/Root/ResumenFactura/${field}`, 'required value is absent');
    return value;
  }

  private optionalDecimal(parent: Element, name: string, path: string): FiscalDecimal | undefined {
    const value = this.text(parent, name);
    return value === undefined ? undefined : this.decimal(value, path);
  }

  private decimal(value: string, path: string): FiscalDecimal {
    if (!/^-?\d+(?:\.\d+)?$/.test(value))
      throw this.projectionFailure(path, 'value is not an exact XML decimal');
    return Object.freeze({ canonical: value });
  }

  private requiredTextAllowEmpty(
    parent: Element,
    name: string,
    path: string,
    maxLength: number,
  ): string {
    const element = this.element(parent, name);
    if (!element) throw this.projectionFailure(path, 'required element is absent');
    const value = element.textContent?.trim() ?? '';
    if (value.length > maxLength)
      throw this.projectionFailure(path, 'value exceeds maximum length ' + maxLength);
    return value;
  }

  private requiredText(parent: Element, name: string, path: string): string {
    const value = this.text(parent, name);
    if (value === undefined) throw this.projectionFailure(path, 'required value is absent');
    return value;
  }

  private text(parent: Element, name: string): string | undefined {
    const value = this.element(parent, name)?.textContent?.trim();
    return value === undefined || value === '' ? undefined : value;
  }

  private element(parent: Element, name: string, required = false): Element | undefined {
    const value = Array.from(parent.childNodes).find(
      (node) => node.nodeType === 1 && (node as Element).localName === name,
    ) as Element | undefined;
    if (required && !value) throw this.projectionFailure(name, 'required element is absent');
    return value;
  }

  private elements(parent: Element, name: string): Element[] {
    return Array.from(parent.childNodes).filter(
      (node): node is Element => node.nodeType === 1 && (node as Element).localName === name,
    );
  }

  private projectionFailure(path: string, reason: string): FiscalXmlProjectionError {
    return new FiscalXmlProjectionError('PROJECTION_FAILED', `${path}: ${reason}`);
  }
}

export function projectionDestinationForMatrixPath(path: string): 'typed' | 'projectedFields' {
  const explicitlyTyped = [
    '/Clave',
    '/ProveedorSistemas',
    '/CodigoActividadEmisor',
    '/CodigoActividadReceptor',
    '/NumeroConsecutivo',
    '/FechaEmision',
    '/Emisor/',
    '/Receptor/',
    '/CondicionVenta',
    '/PlazoCredito',
    '/ResumenFactura/',
    '/DetalleServicio/LineaDetalle',
    '/OtrosCargos',
    '/InformacionReferencia',
    '/Otros/OtroTexto',
  ];
  return explicitlyTyped.some((fragment) => path.includes(fragment)) ? 'typed' : 'projectedFields';
}
