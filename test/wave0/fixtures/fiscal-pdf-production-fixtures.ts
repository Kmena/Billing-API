const FE_NAMESPACE =
  'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica';

export interface Wave0LineFixture {
  readonly number: number;
  readonly unitPriceCents: bigint;
  readonly discountCents: bigint;
  readonly taxCents: bigint;
  readonly totalCents: bigint;
  readonly xml: string;
}

const money = (cents: bigint): string => {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
};

const taxAtThirteenPercent = (baseCents: bigint): bigint => (baseCents * 13n + 50n) / 100n;

function lineFixture(number: number, medication = false): Wave0LineFixture {
  const unitPriceCents = 125000n + BigInt(number) * 100n;
  const discountCents = number % 3 === 0 ? 250n : 0n;
  const subtotalCents = unitPriceCents - discountCents;
  const taxCents = taxAtThirteenPercent(subtotalCents);
  const totalCents = subtotalCents + taxCents;
  const discount =
    discountCents > 0n
      ? `<Descuento><MontoDescuento>${money(discountCents)}</MontoDescuento><CodigoDescuento>01</CodigoDescuento></Descuento>`
      : '';
  const medicationFields = medication
    ? '<RegistroMedicamento>TEST-ONLY-NOT-REGISTERED</RegistroMedicamento><FormaFarmaceutica>TAB</FormaFarmaceutica>'
    : '';
  const description = medication
    ? 'Dato estructural de medicamento de prueba; no representa un medicamento registrado.'
    : `Servicio fiscal de prueba ${String(number).padStart(2, '0')}: descripcion extensa para caracterizar paginacion futura sin usar datos reales.`;

  return {
    number,
    unitPriceCents,
    discountCents,
    taxCents,
    totalCents,
    xml: `<LineaDetalle><NumeroLinea>${number}</NumeroLinea><CodigoCABYS>1234567890123</CodigoCABYS><Cantidad>1.000</Cantidad><UnidadMedida>Unid</UnidadMedida><Detalle>${description}</Detalle>${medicationFields}<PrecioUnitario>${money(unitPriceCents)}</PrecioUnitario><MontoTotal>${money(unitPriceCents)}</MontoTotal>${discount}<SubTotal>${money(subtotalCents)}</SubTotal><BaseImponible>${money(subtotalCents)}</BaseImponible><Impuesto><Codigo>01</Codigo><CodigoTarifaIVA>08</CodigoTarifaIVA><Tarifa>13</Tarifa><Monto>${money(taxCents)}</Monto></Impuesto><ImpuestoAsumidoEmisorFabrica>0.00</ImpuestoAsumidoEmisorFabrica><ImpuestoNeto>${money(taxCents)}</ImpuestoNeto><MontoTotalLinea>${money(totalCents)}</MontoTotalLinea></LineaDetalle>`,
  };
}

function facturaXml(lines: readonly Wave0LineFixture[]): string {
  const grossCents = lines.reduce((total, line) => total + line.unitPriceCents, 0n);
  const discountCents = lines.reduce((total, line) => total + line.discountCents, 0n);
  const taxCents = lines.reduce((total, line) => total + line.taxCents, 0n);
  const totalCents = lines.reduce((total, line) => total + line.totalCents, 0n);
  const netCents = grossCents - discountCents;
  return `<?xml version="1.0" encoding="UTF-8"?><FacturaElectronica xmlns="${FE_NAMESPACE}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><Clave>50612092600310100000000100001010000000001123456789</Clave><ProveedorSistemas>3101000000</ProveedorSistemas><CodigoActividadEmisor>123456</CodigoActividadEmisor><NumeroConsecutivo>00100001010000000001</NumeroConsecutivo><FechaEmision>2026-09-12T10:15:30-06:00</FechaEmision><Emisor><Nombre>Empresa Emisora de Pruebas SA</Nombre><Identificacion><Tipo>02</Tipo><Numero>3101000000</Numero></Identificacion><Ubicacion><Provincia>1</Provincia><Canton>01</Canton><Distrito>01</Distrito><OtrasSenas>Direccion fiscal de pruebas</OtrasSenas></Ubicacion><CorreoElectronico>emisor@example.test</CorreoElectronico></Emisor><Receptor><Nombre>Cliente de Pruebas</Nombre><Identificacion><Tipo>02</Tipo><Numero>3102000000</Numero></Identificacion></Receptor><CondicionVenta>01</CondicionVenta><DetalleServicio>${lines.map((line) => line.xml).join('')}</DetalleServicio><ResumenFactura><CodigoTipoMoneda><CodigoMoneda>CRC</CodigoMoneda><TipoCambio>1.00000</TipoCambio></CodigoTipoMoneda><TotalVenta>${money(grossCents)}</TotalVenta><TotalDescuentos>${money(discountCents)}</TotalDescuentos><TotalVentaNeta>${money(netCents)}</TotalVentaNeta><TotalImpuesto>${money(taxCents)}</TotalImpuesto><TotalComprobante>${money(totalCents)}</TotalComprobante></ResumenFactura><ds:Signature><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><ds:Reference URI=""><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>YWJjZA==</ds:DigestValue></ds:Reference></ds:SignedInfo><ds:SignatureValue>YWJjZA==</ds:SignatureValue></ds:Signature></FacturaElectronica>`;
}

export const medicationFixture = (() => {
  const lines = [lineFixture(1, true)];
  return { lines, xml: facturaXml(lines) };
})();

export const multipageFixture = (() => {
  const lines = Array.from({ length: 30 }, (_, index) => lineFixture(index + 1));
  return { lines, xml: facturaXml(lines) };
})();
