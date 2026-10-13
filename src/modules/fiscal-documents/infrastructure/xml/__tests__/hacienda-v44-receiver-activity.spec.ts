/**
 * Wave 8 — RFR-TASK-801: CodigoActividadReceptor XML serialization
 *
 * Covers:
 *   1.  Valid 6-char receiver.economicActivity → CodigoActividadReceptor emitted
 *   2.  Exact XML value preserved
 *   3.  Element appears at root level (not inside Receptor)
 *   4.  Element does NOT appear inside Receptor
 *   5.  Ordering: CodigoActividadEmisor → CodigoActividadReceptor → NumeroConsecutivo
 *   6.  null receiver.economicActivity → element omitted
 *   7.  undefined / absent receiver.economicActivity → element omitted
 *   8.  Legacy payload without field → still serializes successfully
 *   9.  Length-5 value → rejected with FISCAL_XML_INVALID_RECEIVER_ACTIVITY
 *  10.  Length-7 value → rejected with FISCAL_XML_INVALID_RECEIVER_ACTIVITY
 *  11.  Invalid supplied value is NOT silently omitted
 *  12.  CodigoActividadEmisor behavior unchanged
 *  13.  Existing Receptor serialization unchanged
 *  14.  XML validates against official Hacienda v4.4 XSD (with field)
 *  15.  XML validates against official Hacienda v4.4 XSD (without field — backward compat)
 *
 * Additional:
 *  16.  TICKET type — CodigoActividadReceptor never emitted (TiqueteElectronico XSD lacks field)
 *  17.  Inventori round-trip: receiver.economicActivity value is preserved verbatim in XML
 *  18.  Empty-string economicActivity → element omitted (treated as absent)
 *  19.  Existing FacturaElectronica regression (existing spec snapshot assertions)
 */

import { HaciendaV44XmlSerializerAdapter } from '../hacienda-v44-xml-serializer.adapter';
import { Xsd11ValidatorAdapter } from '../xsd11-validator.adapter';
import { createFiscalXmlSnapshot } from '../../../domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import { FiscalXmlGenerationResult } from '../../../domain/fiscal-xml/fiscal-xml.types';

const serializer = new HaciendaV44XmlSerializerAdapter();
const validator = new Xsd11ValidatorAdapter();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Base INVOICE snapshot — receiver has no economicActivity. */
function invoiceSnapshot(receiverOverrides: Record<string, unknown> = {}) {
  const base = createFiscalXmlSnapshot('INVOICE');
  return {
    ...base,
    receiverSnapshot: {
      ...(base.receiverSnapshot as Record<string, unknown>),
      ...receiverOverrides,
    },
  };
}

/**
 * Wraps unsigned XML with a dummy XAdES signature so the XSD validator is
 * satisfied (it requires the ds:Signature element).
 * Same technique used in inventori-p0-fiscal-compatibility.spec.ts.
 */
function withDummySignature(xml: string): string {
  const sig =
    '<ds:Signature>' +
    '<ds:SignedInfo>' +
    '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
    '<ds:Reference URI="">' +
    '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
    '<ds:DigestValue>YWJjZA==</ds:DigestValue>' +
    '</ds:Reference>' +
    '</ds:SignedInfo>' +
    '<ds:SignatureValue>YWJjZA==</ds:SignatureValue>' +
    '</ds:Signature>';
  return xml.replace('</FacturaElectronica>', `${sig}</FacturaElectronica>`);
}

function xsdValidate(xml: string): FiscalXmlGenerationResult {
  return {
    documentType: 'INVOICE',
    rootElement: 'FacturaElectronica',
    namespace: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica',
    schemaVersion: 'v4.4',
    xml: withDummySignature(xml),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RFR-TASK-801 — CodigoActividadReceptor XML serialization (Wave 8)', () => {
  // ── Test 1 & 2: valid 6-char value → emitted, value preserved ───────────────
  it('emits CodigoActividadReceptor with the exact value when economicActivity is a valid 6-char code', () => {
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: '620200' }));

    expect(result.xml).toContain('<CodigoActividadReceptor>620200</CodigoActividadReceptor>');
  });

  // ── Test 3: root level, not inside Receptor ──────────────────────────────────
  it('emits CodigoActividadReceptor at the ROOT element level, not inside Receptor', () => {
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: '620200' }));

    // Must appear somewhere in the XML
    expect(result.xml).toContain('<CodigoActividadReceptor>');

    // Must NOT appear inside <Receptor>…</Receptor>
    const receptorStart = result.xml.indexOf('<Receptor>');
    const receptorEnd = result.xml.indexOf('</Receptor>');
    expect(receptorStart).toBeGreaterThan(0);
    expect(receptorEnd).toBeGreaterThan(receptorStart);

    const receptorBlock = result.xml.slice(receptorStart, receptorEnd + '</Receptor>'.length);
    expect(receptorBlock).not.toContain('<CodigoActividadReceptor>');
  });

  // ── Test 4: redundant guard — element NOT inside Receptor ────────────────────
  it('does not nest CodigoActividadReceptor inside the Receptor element', () => {
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: '620200' }));

    // Extra explicit assertion: the string "<Receptor>" must not be followed by
    // "<CodigoActividadReceptor>" before the closing "</Receptor>"
    const receptorOpenIdx = result.xml.indexOf('<Receptor>');
    const receptorCloseIdx = result.xml.indexOf('</Receptor>');
    const activityInReceptor = result.xml
      .slice(receptorOpenIdx, receptorCloseIdx)
      .includes('<CodigoActividadReceptor>');
    expect(activityInReceptor).toBe(false);
  });

  // ── Test 5: ordering — CodigoActividadEmisor → CodigoActividadReceptor → NumeroConsecutivo
  it('emits CodigoActividadEmisor → CodigoActividadReceptor → NumeroConsecutivo in XSD sequence order', () => {
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: '620200' }));

    const emisorPos = result.xml.indexOf('<CodigoActividadEmisor>');
    const receptorPos = result.xml.indexOf('<CodigoActividadReceptor>');
    const consecutivoPos = result.xml.indexOf('<NumeroConsecutivo>');

    expect(emisorPos).toBeGreaterThan(0);
    expect(receptorPos).toBeGreaterThan(emisorPos);
    expect(consecutivoPos).toBeGreaterThan(receptorPos);
  });

  // ── Test 6: null → omitted ───────────────────────────────────────────────────
  it('omits CodigoActividadReceptor when economicActivity is explicitly null', () => {
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: null }));

    expect(result.xml).not.toContain('<CodigoActividadReceptor>');
    expect(result.xml).not.toContain('CodigoActividadReceptor');
  });

  // ── Test 7: undefined / absent → omitted ────────────────────────────────────
  it('omits CodigoActividadReceptor when economicActivity is undefined', () => {
    const base = createFiscalXmlSnapshot('INVOICE');
    const receiverWithoutField = { ...(base.receiverSnapshot as Record<string, unknown>) };
    delete receiverWithoutField['economicActivity'];
    const result = serializer.serialize({ ...base, receiverSnapshot: receiverWithoutField });

    expect(result.xml).not.toContain('CodigoActividadReceptor');
  });

  it('omits CodigoActividadReceptor when economicActivity is absent from receiver object', () => {
    // The fixture receiver does not include economicActivity — this is the standard shape
    const result = serializer.serialize(createFiscalXmlSnapshot('INVOICE'));

    expect(result.xml).not.toContain('CodigoActividadReceptor');
  });

  // ── Test 8: legacy payload (no field at all) → still serializes ──────────────
  it('serializes legacy INVOICE payload without receiver.economicActivity successfully', () => {
    const snapshot = createFiscalXmlSnapshot('INVOICE');
    expect(() => serializer.serialize(snapshot)).not.toThrow();
    const result = serializer.serialize(snapshot);
    expect(result.xml).toContain('<FacturaElectronica');
    expect(result.xml).not.toContain('CodigoActividadReceptor');
  });

  // ── Test 9: 5-char → rejected ────────────────────────────────────────────────
  it('rejects a 5-character receiver economicActivity with FISCAL_XML_INVALID_RECEIVER_ACTIVITY', () => {
    expect(() => serializer.serialize(invoiceSnapshot({ economicActivity: '62020' }))).toThrow(
      'FISCAL_XML_INVALID_RECEIVER_ACTIVITY',
    );
  });

  // ── Test 10: 7-char → rejected ───────────────────────────────────────────────
  it('rejects a 7-character receiver economicActivity with FISCAL_XML_INVALID_RECEIVER_ACTIVITY', () => {
    expect(() => serializer.serialize(invoiceSnapshot({ economicActivity: '6202001' }))).toThrow(
      'FISCAL_XML_INVALID_RECEIVER_ACTIVITY',
    );
  });

  // ── Test 11: invalid value is NOT silently omitted ────────────────────────────
  it('throws — does NOT silently omit — when a supplied economicActivity is invalid', () => {
    // 1-char: clearly invalid, must throw, NOT be silently swallowed
    const throwFn = () => serializer.serialize(invoiceSnapshot({ economicActivity: '6' }));
    expect(throwFn).toThrow();
    try {
      throwFn();
    } catch (error) {
      expect((error as Error).message).toBe('FISCAL_XML_INVALID_RECEIVER_ACTIVITY');
    }
  });

  // ── Test 12: CodigoActividadEmisor unchanged ─────────────────────────────────
  it('preserves CodigoActividadEmisor value and position when CodigoActividadReceptor is present', () => {
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: '620200' }));

    expect(result.xml).toContain('<CodigoActividadEmisor>620200</CodigoActividadEmisor>');
    // Emisor activity still precedes Receptor activity
    expect(result.xml.indexOf('<CodigoActividadEmisor>')).toBeLessThan(
      result.xml.indexOf('<CodigoActividadReceptor>'),
    );
  });

  it('preserves CodigoActividadEmisor when CodigoActividadReceptor is absent', () => {
    const result = serializer.serialize(createFiscalXmlSnapshot('INVOICE'));

    expect(result.xml).toContain('<CodigoActividadEmisor>620200</CodigoActividadEmisor>');
  });

  // ── Test 13: Receptor content unchanged ──────────────────────────────────────
  it('does not alter the Receptor element content when CodigoActividadReceptor is emitted', () => {
    const withActivity = serializer.serialize(invoiceSnapshot({ economicActivity: '620200' }));
    const withoutActivity = serializer.serialize(createFiscalXmlSnapshot('INVOICE'));

    // Extract Receptor blocks from both and compare
    const extractReceptor = (xml: string) => {
      const start = xml.indexOf('<Receptor>');
      const end = xml.indexOf('</Receptor>') + '</Receptor>'.length;
      return xml.slice(start, end);
    };

    expect(extractReceptor(withActivity.xml)).toBe(extractReceptor(withoutActivity.xml));
  });

  // ── Test 14: XSD validation WITH CodigoActividadReceptor ─────────────────────
  it('produces XSD-valid FacturaElectronica XML when CodigoActividadReceptor is present', () => {
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: '620200' }));

    const validation = validator.validate(xsdValidate(result.xml));

    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  // ── Test 15: XSD validation WITHOUT CodigoActividadReceptor (backward compat) ─
  it('produces XSD-valid FacturaElectronica XML when CodigoActividadReceptor is absent', () => {
    const result = serializer.serialize(createFiscalXmlSnapshot('INVOICE'));

    const validation = validator.validate(xsdValidate(result.xml));

    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  // ── Test 16: TICKET — CodigoActividadReceptor never emitted ──────────────────
  it('never emits CodigoActividadReceptor for TiqueteElectronico (XSD lacks the element)', () => {
    const ticket = createFiscalXmlSnapshot('TICKET');
    const result = serializer.serialize(ticket);

    expect(result.rootElement).toBe('TiqueteElectronico');
    expect(result.xml).not.toContain('CodigoActividadReceptor');
  });

  // ── Test 17: Inventori round-trip contract ────────────────────────────────────
  it('round-trip: Inventori receiver.economicActivity value is preserved verbatim in CodigoActividadReceptor', () => {
    // Exact shape Inventori sends per RFR-TASK-801 source contract
    const inventoriReceiverShape = {
      name: 'Receptor Inventori SA',
      identificationType: 'JURIDICA',
      identificationNumber: '3101000001',
      email: 'receiver@example.com',
      economicActivity: '620200', // selectedEconomicActivityCode
    };

    const base = createFiscalXmlSnapshot('INVOICE');
    const result = serializer.serialize({ ...base, receiverSnapshot: inventoriReceiverShape });

    // Value must be identical — no transformation
    expect(result.xml).toContain('<CodigoActividadReceptor>620200</CodigoActividadReceptor>');
    // Confirm not inside Receptor
    const receptorStart = result.xml.indexOf('<Receptor>');
    const receptorEnd = result.xml.indexOf('</Receptor>');
    const receptorBlock = result.xml.slice(receptorStart, receptorEnd);
    expect(receptorBlock).not.toContain('<CodigoActividadReceptor>');
  });

  // ── Test 18: empty string → omitted (treated as absent) ──────────────────────
  it('omits CodigoActividadReceptor when economicActivity is an empty string', () => {
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: '' }));

    expect(result.xml).not.toContain('CodigoActividadReceptor');
  });

  // ── Test 19: existing FacturaElectronica assertions remain valid ───────────────
  it('existing FacturaElectronica regression: all prior structural assertions hold with economicActivity absent', () => {
    const snapshot = createFiscalXmlSnapshot('INVOICE');
    const result = serializer.serialize(snapshot);

    // Pre-existing ordering assertions (from hacienda-v44-xml-serializer.adapter.spec.ts)
    expect(result.xml.indexOf('<Clave>')).toBeLessThan(result.xml.indexOf('<ProveedorSistemas>'));
    expect(result.xml.indexOf('<ProveedorSistemas>')).toBeLessThan(
      result.xml.indexOf('<CodigoActividadEmisor>'),
    );
    expect(result.xml.indexOf('<CodigoActividadEmisor>')).toBeLessThan(
      result.xml.indexOf('<NumeroConsecutivo>'),
    );
    expect(result.xml.indexOf('<NumeroConsecutivo>')).toBeLessThan(
      result.xml.indexOf('<FechaEmision>'),
    );
    expect(result.xml).toContain('<TotalComprobante>1130.00000</TotalComprobante>');
    expect(result.xml).not.toContain('<ds:Signature');
    expect(result.xml).not.toContain('CodigoActividadReceptor');
  });

  // ── Bonus: ordering guarantee when field present ──────────────────────────────
  it('maintains Clave → ProveedorSistemas → CodigoActividadEmisor → CodigoActividadReceptor → NumeroConsecutivo order', () => {
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: '620200' }));

    const positions = {
      clave: result.xml.indexOf('<Clave>'),
      proveedor: result.xml.indexOf('<ProveedorSistemas>'),
      emisor: result.xml.indexOf('<CodigoActividadEmisor>'),
      receptor: result.xml.indexOf('<CodigoActividadReceptor>'),
      consecutivo: result.xml.indexOf('<NumeroConsecutivo>'),
    };

    expect(positions.clave).toBeLessThan(positions.proveedor);
    expect(positions.proveedor).toBeLessThan(positions.emisor);
    expect(positions.emisor).toBeLessThan(positions.receptor);
    expect(positions.receptor).toBeLessThan(positions.consecutivo);
  });

  // ── Various valid 6-char codes ────────────────────────────────────────────────
  it.each([
    ['all-numeric', '620200'],
    ['alternative code', '510100'],
    ['boundary digits', '000001'],
    ['max digits', '999999'],
  ])('emits CodigoActividadReceptor for valid 6-char code: %s (%s)', (_label, code) => {
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: code }));
    expect(result.xml).toContain(`<CodigoActividadReceptor>${code}</CodigoActividadReceptor>`);
  });

  // ── Edge: whitespace-padded value ────────────────────────────────────────────
  it('trims leading/trailing whitespace from the economicActivity value before length validation', () => {
    // "  620200  " trims to "620200" (6 chars) → valid → emitted
    const result = serializer.serialize(invoiceSnapshot({ economicActivity: '  620200  ' }));
    expect(result.xml).toContain('<CodigoActividadReceptor>620200</CodigoActividadReceptor>');
  });

  it('rejects a whitespace-padded value that trims to fewer than 6 chars', () => {
    // "  6202  " trims to "6202" (4 chars) → invalid → throw
    expect(() => serializer.serialize(invoiceSnapshot({ economicActivity: '  6202  ' }))).toThrow(
      'FISCAL_XML_INVALID_RECEIVER_ACTIVITY',
    );
  });
});
