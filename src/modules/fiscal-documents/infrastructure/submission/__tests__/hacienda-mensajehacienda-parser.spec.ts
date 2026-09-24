import {
  parseMensajeHacienda,
  type HaciendaFiscalResponseParseResult,
} from '../hacienda-mensajehacienda-parser';

// ── Helpers ───────────────────────────────────────────────────────────────────

const NS = 'xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda"';

function wrap(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><MensajeHacienda ${NS}>${inner}</MensajeHacienda>`;
}

const REAL_REJECTION_DETALLE = [
  'Este comprobante fue recibido en el ambiente de pruebas, por lo cual no tiene validez para fines tributarios.',
  '',
  'El comprobante electrónico tiene los siguientes errores: &#13;',
  '[&#13;',
  'La firma del documento no tiene el Policy Id&#13;',
  ']',
].join('\n');

const REAL_REJECTION_XML = wrap(
  [
    '<Clave>50622092600310100000000100001010000000007157079215</Clave>',
    '<NombreEmisor>DESCONOCIDO</NombreEmisor>',
    '<TipoIdentificacionEmisor>02</TipoIdentificacionEmisor>',
    '<NumeroCedulaEmisor>3101000000</NumeroCedulaEmisor>',
    '<TipoIdentificacionReceptor>02</TipoIdentificacionReceptor>',
    '<NumeroCedulaReceptor>3101000001</NumeroCedulaReceptor>',
    '<Mensaje>3</Mensaje>',
    '<EstadoMensaje>Rechazado</EstadoMensaje>',
    `<DetalleMensaje>${REAL_REJECTION_DETALLE}</DetalleMensaje>`,
    '<TotalFactura>0</TotalFactura>',
    '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SKIPPED</ds:Signature>',
  ].join('\n'),
);

// ── rechazado + Mensaje + DetalleMensaje ──────────────────────────────────────

describe('parseMensajeHacienda — rechazado', () => {
  let result: HaciendaFiscalResponseParseResult;

  beforeEach(() => {
    result = parseMensajeHacienda(REAL_REJECTION_XML);
  });

  it('returns no parseError for well-formed rechazado XML', () => {
    expect(result.parseError).toBeUndefined();
  });

  it('extracts mensaje = "3"', () => {
    expect(result.diagnostic.mensaje).toBe('3');
  });

  it('extracts estadoMensaje = "Rechazado"', () => {
    expect(result.diagnostic.estadoMensaje).toBe('Rechazado');
  });

  it('extracts detalleMensaje with the rejection reason', () => {
    expect(result.diagnostic.detalleMensaje).toContain(
      'La firma del documento no tiene el Policy Id',
    );
  });

  it('detalleMensaje decodes &#13; entities (no literal CR chars in output)', () => {
    expect(result.diagnostic.detalleMensaje).not.toContain('\r');
  });

  it('detalleMensaje does NOT contain raw XML entity references', () => {
    expect(result.diagnostic.detalleMensaje).not.toContain('&#13;');
  });

  it('does NOT expose NumeroCedulaEmisor', () => {
    expect(JSON.stringify(result.diagnostic)).not.toContain('3101000000');
  });

  it('does NOT expose NombreEmisor', () => {
    expect(JSON.stringify(result.diagnostic)).not.toContain('DESCONOCIDO');
  });

  it('does NOT expose ds:Signature content', () => {
    expect(JSON.stringify(result.diagnostic)).not.toContain('SKIPPED');
  });
});

// ── aceptado + response XML ───────────────────────────────────────────────────

describe('parseMensajeHacienda — aceptado', () => {
  const xml = wrap(
    [
      '<Clave>50601012500310112345600100001010000000001100000001</Clave>',
      '<Mensaje>1</Mensaje>',
      '<EstadoMensaje>Aceptado</EstadoMensaje>',
      '<DetalleMensaje>Comprobante electrónico aceptado satisfactoriamente.</DetalleMensaje>',
      '<TotalFactura>1000</TotalFactura>',
    ].join(''),
  );

  it('extracts mensaje = "1"', () => {
    expect(parseMensajeHacienda(xml).diagnostic.mensaje).toBe('1');
  });

  it('extracts estadoMensaje = "Aceptado"', () => {
    expect(parseMensajeHacienda(xml).diagnostic.estadoMensaje).toBe('Aceptado');
  });

  it('extracts detalleMensaje', () => {
    expect(parseMensajeHacienda(xml).diagnostic.detalleMensaje).toBe(
      'Comprobante electrónico aceptado satisfactoriamente.',
    );
  });

  it('returns no parseError', () => {
    expect(parseMensajeHacienda(xml).parseError).toBeUndefined();
  });
});

// ── respuesta-xml absent / empty ──────────────────────────────────────────────

describe('parseMensajeHacienda — absent or non-MensajeHacienda input', () => {
  it('returns INPUT_NOT_MENSAJEHACIENDA for empty string', () => {
    expect(parseMensajeHacienda('').parseError).toBe('INPUT_NOT_MENSAJEHACIENDA');
  });

  it('returns INPUT_NOT_MENSAJEHACIENDA for empty buffer', () => {
    expect(parseMensajeHacienda(Buffer.from('')).parseError).toBe('INPUT_NOT_MENSAJEHACIENDA');
  });

  it('returns empty diagnostic for non-Hacienda XML', () => {
    const other = '<root><Mensaje>3</Mensaje></root>';
    expect(parseMensajeHacienda(other).parseError).toBe('INPUT_NOT_MENSAJEHACIENDA');
    expect(parseMensajeHacienda(other).diagnostic).toEqual({});
  });

  it('returns no diagnostic fields for absent input', () => {
    const r = parseMensajeHacienda('');
    expect(r.diagnostic.mensaje).toBeUndefined();
    expect(r.diagnostic.detalleMensaje).toBeUndefined();
    expect(r.diagnostic.estadoMensaje).toBeUndefined();
  });
});

// ── malformed respuesta-xml ───────────────────────────────────────────────────

describe('parseMensajeHacienda — malformed XML', () => {
  it('returns NO_SAFE_ELEMENTS_FOUND when MensajeHacienda marker present but no extractable elements', () => {
    const malformed = `<MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda"><Truncated`;
    const r = parseMensajeHacienda(malformed);
    expect(r.parseError).toBeDefined();
    expect(r.diagnostic).toEqual({});
  });

  it('still extracts whatever IS parseable from partially truncated XML', () => {
    const partial = wrap('<Mensaje>3</Mensaje><DetalleMensaje>truncated without closing');
    const r = parseMensajeHacienda(partial);
    // Mensaje is closed — should be extracted; DetalleMensaje is not — ignored
    expect(r.diagnostic.mensaje).toBe('3');
    expect(r.diagnostic.detalleMensaje).toBeUndefined();
    expect(r.parseError).toBeUndefined(); // Mensaje was found; no error
  });

  it('malformed DetalleMensaje does NOT prevent Mensaje extraction', () => {
    const xml = wrap('<Mensaje>3</Mensaje><DetalleMensaje>unclosed');
    expect(parseMensajeHacienda(xml).diagnostic.mensaje).toBe('3');
  });

  it('accepts Buffer input', () => {
    const buf = Buffer.from(REAL_REJECTION_XML, 'utf8');
    const r = parseMensajeHacienda(buf);
    expect(r.diagnostic.mensaje).toBe('3');
    expect(r.parseError).toBeUndefined();
  });
});

// ── unknown additional XML elements ──────────────────────────────────────────

describe('parseMensajeHacienda — unknown elements', () => {
  it('ignores unknown elements and still extracts known ones', () => {
    const xml = wrap(
      '<FutureField>should-be-ignored</FutureField>' +
        '<Mensaje>2</Mensaje>' +
        '<AnotherNewField><nested>data</nested></AnotherNewField>' +
        '<EstadoMensaje>Aceptado</EstadoMensaje>',
    );
    const r = parseMensajeHacienda(xml);
    expect(r.diagnostic.mensaje).toBe('2');
    expect(r.diagnostic.estadoMensaje).toBe('Aceptado');
    expect(JSON.stringify(r.diagnostic)).not.toContain('should-be-ignored');
  });
});

// ── XML namespaces ────────────────────────────────────────────────────────────

describe('parseMensajeHacienda — XML namespaces', () => {
  it('handles default namespace on root element correctly', () => {
    // The NS is on the root MensajeHacienda element — children use unprefixed names
    const r = parseMensajeHacienda(REAL_REJECTION_XML);
    expect(r.parseError).toBeUndefined();
  });

  it('does NOT confuse ds:Signature sub-elements with safe elements', () => {
    const xml = wrap(
      '<Mensaje>3</Mensaje>' +
        '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
        '<ds:SignedInfo><ds:CanonicalizationMethod/></ds:SignedInfo>' +
        '</ds:Signature>',
    );
    const r = parseMensajeHacienda(xml);
    expect(r.diagnostic.mensaje).toBe('3');
    // SignedInfo / CanonicalizationMethod must not appear in diagnostic
    expect(JSON.stringify(r.diagnostic)).not.toContain('CanonicalizationMethod');
  });
});

// ── DetalleMensaje multiline content ─────────────────────────────────────────

describe('parseMensajeHacienda — multiline DetalleMensaje', () => {
  it('preserves line breaks (normalised to \\n) from multiline content', () => {
    const xml = wrap(
      '<Mensaje>3</Mensaje>' + '<DetalleMensaje>Line one\nLine two\nLine three</DetalleMensaje>',
    );
    const d = parseMensajeHacienda(xml).diagnostic.detalleMensaje ?? '';
    expect(d).toContain('\n');
    expect(d.split('\n').length).toBeGreaterThan(1);
  });

  it('normalises &#13; (CR entities) to \\n in multiline content', () => {
    const xml = wrap(
      '<DetalleMensaje>First&#13;\nSecond&#13;\nThird</DetalleMensaje>' + `<Mensaje>3</Mensaje>`,
    );
    const d = parseMensajeHacienda(xml).diagnostic.detalleMensaje ?? '';
    expect(d).not.toContain('\r');
    expect(d).not.toContain('&#13;');
    expect(d.split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('collapses 3 or more consecutive blank lines to 2', () => {
    const xml = wrap('<Mensaje>3</Mensaje>' + '<DetalleMensaje>A\n\n\n\n\nB</DetalleMensaje>');
    const d = parseMensajeHacienda(xml).diagnostic.detalleMensaje ?? '';
    expect(d).not.toContain('\n\n\n');
    expect(d).toContain('A\n\nB');
  });
});

// ── Sanitisation ──────────────────────────────────────────────────────────────

describe('parseMensajeHacienda — sanitisation', () => {
  it('strips ANSI escape sequences from DetalleMensaje', () => {
    const xml = wrap(
      '<Mensaje>3</Mensaje><DetalleMensaje>normal \x1b[31mred\x1b[0m text</DetalleMensaje>',
    );
    const d = parseMensajeHacienda(xml).diagnostic.detalleMensaje ?? '';
    expect(d).not.toContain('\x1b');
    expect(d).toContain('normal');
    expect(d).toContain('text');
  });

  it('removes null bytes and other control chars from DetalleMensaje', () => {
    const xml = wrap('<Mensaje>3</Mensaje><DetalleMensaje>clean\x00\x01\x02text</DetalleMensaje>');
    const d = parseMensajeHacienda(xml).diagnostic.detalleMensaje ?? '';
    expect(d).not.toMatch(/[\x00-\x08]/);
    expect(d).toContain('clean');
    expect(d).toContain('text');
  });

  it('strips XML/HTML tags from DetalleMensaje', () => {
    const xml = wrap(
      '<Mensaje>3</Mensaje><DetalleMensaje>error: <b>bold</b> message</DetalleMensaje>',
    );
    const d = parseMensajeHacienda(xml).diagnostic.detalleMensaje ?? '';
    expect(d).not.toContain('<b>');
    expect(d).not.toContain('</b>');
    expect(d).toContain('error:');
    expect(d).toContain('bold');
    expect(d).toContain('message');
  });

  it('estadoMensaje is bounded to 100 characters', () => {
    const longStatus = 'A'.repeat(200);
    const xml = wrap(`<Mensaje>3</Mensaje><EstadoMensaje>${longStatus}</EstadoMensaje>`);
    const s = parseMensajeHacienda(xml).diagnostic.estadoMensaje ?? '';
    expect(s.length).toBeLessThanOrEqual(100);
  });
});

// ── Bounded diagnostic length ─────────────────────────────────────────────────

describe('parseMensajeHacienda — length bounds', () => {
  it('bounds detalleMensaje to 500 characters', () => {
    const longText = 'X'.repeat(1000);
    const xml = wrap(`<Mensaje>3</Mensaje><DetalleMensaje>${longText}</DetalleMensaje>`);
    const d = parseMensajeHacienda(xml).diagnostic.detalleMensaje ?? '';
    expect(d.length).toBeLessThanOrEqual(500);
  });

  it('does not truncate detalleMensaje shorter than 500 chars', () => {
    const text = 'Short rejection reason.';
    const xml = wrap(`<Mensaje>3</Mensaje><DetalleMensaje>${text}</DetalleMensaje>`);
    expect(parseMensajeHacienda(xml).diagnostic.detalleMensaje).toBe(text);
  });

  it('bounds mensaje to 100 characters', () => {
    const xml = wrap(`<Mensaje>${'3'.repeat(200)}</Mensaje>`);
    const m = parseMensajeHacienda(xml).diagnostic.mensaje ?? '';
    expect(m.length).toBeLessThanOrEqual(100);
  });
});

// ── State-transition isolation ────────────────────────────────────────────────

describe('parseMensajeHacienda — parseError does not block state transition', () => {
  it('returns parseError for completely malformed input without throwing', () => {
    expect(() => parseMensajeHacienda('not xml at all')).not.toThrow();
    expect(parseMensajeHacienda('not xml at all').parseError).toBeDefined();
  });

  it('returns parseError for input missing the namespace', () => {
    const noNs = '<MensajeHacienda><Mensaje>3</Mensaje></MensajeHacienda>';
    expect(parseMensajeHacienda(noNs).parseError).toBe('INPUT_NOT_MENSAJEHACIENDA');
  });

  it('diagnostic is always a plain object (never throws, never rejects)', async () => {
    const inputs = ['', '   ', '<broken', Buffer.from(''), Buffer.from('<x/>')];
    for (const input of inputs) {
      const r = parseMensajeHacienda(input);
      expect(typeof r.diagnostic).toBe('object');
    }
  });
});
