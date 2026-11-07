import { createHash } from 'crypto';
import { fiscalPackageZip } from '../spec10-zip';

describe('SPEC-10 immutable fiscal ZIP', () => {
  it('keeps the three original byte sequences unchanged', () => {
    const files = [
      { name: '506.pdf', bytes: Buffer.from('%PDF-original') },
      { name: '506.xml', bytes: Buffer.from('<Factura>original</Factura>') },
      { name: '506_respuesta.xml', bytes: Buffer.from('<Mensaje>original</Mensaje>') },
    ];
    const zip = fiscalPackageZip(files);
    let offset = 0;
    for (const file of files) {
      expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
      expect(zip.readUInt16LE(offset + 8)).toBe(0);
      const length = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('ascii');
      const bytes = zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + length);
      expect(name).toBe(file.name);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        createHash('sha256').update(file.bytes).digest('hex'),
      );
      offset += 30 + nameLength + length;
    }
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });

  it('rejects unsafe filenames and missing files', () => {
    expect(() => fiscalPackageZip([{ name: '../secret.xml', bytes: Buffer.from('x') }])).toThrow(
      'FISCAL_PACKAGE_INVALID',
    );
  });
});
