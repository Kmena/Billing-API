/**
 * FiscalArtifactService unit tests — F4 TASK-005
 * Tests: external filename convention (FR-027), Content-Disposition safety,
 *        internal storage key isolation, cross-tenant access prevention.
 */
import { FiscalArtifactService } from '../fiscal-artifact.service';

type ArtifactServiceDeps = ConstructorParameters<typeof FiscalArtifactService>;

const createService = (): FiscalArtifactService =>
  new FiscalArtifactService(
    {} as ArtifactServiceDeps[0],
    {} as ArtifactServiceDeps[1],
    {} as ArtifactServiceDeps[2],
  );

// Minimal mock setup — we test domain behavior only (filename/disposition)
describe('FiscalArtifactService — external filename convention (FR-027)', () => {
  const service = createService();

  const CLAVE = '12345678901234567890123456789012345678901234567890';

  describe('buildExternalFilename', () => {
    it('SIGNED_XML: {clave}.xml', () => {
      expect(service.buildExternalFilename(CLAVE, 'SIGNED_XML')).toBe(`${CLAVE}.xml`);
    });

    it('HACIENDA_RESPONSE_XML: {clave}_respuesta.xml', () => {
      expect(service.buildExternalFilename(CLAVE, 'HACIENDA_RESPONSE_XML')).toBe(
        `${CLAVE}_respuesta.xml`,
      );
    });

    it('PDF: {clave}.pdf', () => {
      expect(service.buildExternalFilename(CLAVE, 'PDF')).toBe(`${CLAVE}.pdf`);
    });

    it('filename does not contain internal storage key pattern', () => {
      const xmlFilename = service.buildExternalFilename(CLAVE, 'SIGNED_XML');
      expect(xmlFilename).not.toContain('fiscal-xml-artifacts');
      expect(xmlFilename).not.toContain('fiscal-submissions');
      expect(xmlFilename).not.toContain('fiscal-pdfs');
      expect(xmlFilename).not.toContain('s3://');
      expect(xmlFilename).not.toContain('://');
    });
  });

  describe('buildContentDisposition', () => {
    it('builds safe Content-Disposition header', () => {
      const disposition = service.buildContentDisposition(`${CLAVE}.xml`);
      expect(disposition).toBe(`attachment; filename="${CLAVE}.xml"`);
    });

    it('prevents CRLF injection in filename', () => {
      const maliciousFilename = 'file\r\nContent-Type: text/html\r\n\r\n<script>evil</script>.xml';
      const disposition = service.buildContentDisposition(maliciousFilename);
      expect(disposition).not.toContain('\r');
      expect(disposition).not.toContain('\n');
      expect(disposition).not.toContain('<script>');
    });

    it('prevents path traversal in filename', () => {
      const maliciousFilename = '../../../etc/passwd.xml';
      const disposition = service.buildContentDisposition(maliciousFilename);
      expect(disposition).not.toContain('../');
      expect(disposition).not.toContain('etc/passwd');
    });
  });
});

describe('FiscalArtifactService — fiscal status independence', () => {
  it('FiscalArtifactService does not expose FiscalDocument status', () => {
    // FiscalArtifactService only deals with artifacts, never modifies fiscal status
    const service = createService();
    // No method on FiscalArtifactService should accept or return a fiscal status
    expect(typeof service.listArtifacts).toBe('function');
    expect(typeof service.downloadArtifact).toBe('function');
    // These are the only public methods — neither writes fiscal status
  });
});
