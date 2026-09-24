import { generateKeyPairSync, X509Certificate } from 'crypto';
import * as forge from 'node-forge';
import { FiscalXmlDocumentSnapshot } from '../fiscal-xml.types';

export function createFiscalXmlSnapshot(
  type: 'INVOICE' | 'TICKET' = 'INVOICE',
): FiscalXmlDocumentSnapshot {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    companyId: '33333333-3333-4333-8333-333333333333',
    environment: 'SANDBOX',
    type,
    status: 'READY_FOR_XML',
    clave: '50612092600310100000000100001010000000001123456789',
    consecutive: type === 'INVOICE' ? '00100001010000000001' : '00100001040000000001',
    issueDate: new Date('2026-09-12T10:20:30.000Z'),
    issuerSnapshot: {
      legalName: 'Billing Test Sociedad Anonima',
      tradeName: 'Billing Test',
      identificationType: 'JURIDICA',
      identificationNumber: '3101000000',
      codigoActividad: '620200',
      proveedorSistemas: '3101234567',
      provincia: '1',
      canton: '01',
      distrito: '01',
      otrasSenas: 'San Jose centro, edificio de pruebas',
      email: 'issuer@example.com',
    },
    receiverSnapshot:
      type === 'INVOICE'
        ? {
            name: 'Receiver Test Sociedad Anonima',
            identificationType: 'JURIDICA',
            identificationNumber: '3101000001',
            email: 'receiver@example.com',
          }
        : null,
    currency: 'CRC',
    exchangeRate: '1.00000',
    saleCondition: '01',
    paymentMethod: '01',
    lines: [
      {
        lineNumber: 1,
        // Real CAByS catalog entry: "Servicios de consultoría en software" (first digit 8 → SERVICE)
        cabysCode: '8313100000100',
        description: 'Servicio fiscal de prueba',
        unitMeasure: 'Sp',
        quantity: '1.00000',
        unitPrice: '1000.00000',
        taxAmount: '130.00000',
        taxCode: '01',
        taxRateCode: '08',
        taxRate: '13.00000',
      },
    ],
    totals: {
      grossAmount: '1000.00000',
      discountAmount: '0.00000',
      taxAmount: '130.00000',
      totalAmount: '1130.00000',
    },
  };
}

export function createTestSigningMaterial(passphrase = 'test-passphrase') {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = publicKey;
  certificate.serialNumber = '01F23A001';
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00.000Z');
  certificate.validity.notAfter = new Date('2027-01-01T00:00:00.000Z');
  certificate.setSubject([{ name: 'commonName', value: 'F2.3 XAdES Test Certificate' }]);
  certificate.setIssuer([{ name: 'commonName', value: 'F2.3 Test CA' }]);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  certificate.sign(privateKey, forge.md.sha256.create());
  const pkcs12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, certificate, passphrase, {
    algorithm: '3des',
  });
  const pkcs12Der = Buffer.from(forge.asn1.toDer(pkcs12Asn1).getBytes(), 'binary');
  const certificateDerBase64 = forge.util.encode64(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(),
  );
  const x509Certificate = new X509Certificate(Buffer.from(certificateDerBase64, 'base64'));
  return {
    passphrase,
    certificateDerBase64,
    x509Subject: x509Certificate.subject,
    x509SerialNumber: x509Certificate.serialNumber,
    pkcs12Base64: pkcs12Der.toString('base64'),
    certificate: {
      data: pkcs12Der,
      passphrase,
    },
  };
}

/**
 * Creates a test PKCS#12 with a Costa Rica fiscal identity OID 2.5.4.5 in the subject.
 * The fiscalIdentity parameter should include the prefix if desired (e.g. 'CPJ-3102123456').
 * Used by TASK-001 tests — never use real certificates.
 */
export function createTestSigningMaterialWithFiscalId(
  fiscalIdentity: string,
  passphrase = 'test-passphrase',
  opts: {
    notBefore?: Date;
    notAfter?: Date;
  } = {},
) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = publicKey;
  certificate.serialNumber = '0AF23B002';
  certificate.validity.notBefore = opts.notBefore ?? new Date('2026-01-01T00:00:00.000Z');
  certificate.validity.notAfter = opts.notAfter ?? new Date('2027-01-01T00:00:00.000Z');
  // Include OID 2.5.4.5 (serialNumber) with the fiscal identity
  certificate.setSubject([
    { name: 'commonName', value: 'CR Fiscal Test Certificate' },
    { type: '2.5.4.5', value: fiscalIdentity },
  ]);
  certificate.setIssuer([{ name: 'commonName', value: 'CR Test Hacienda CA' }]);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  certificate.sign(privateKey, forge.md.sha256.create());
  const pkcs12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, certificate, passphrase, {
    algorithm: '3des',
  });
  const pkcs12Der = Buffer.from(forge.asn1.toDer(pkcs12Asn1).getBytes(), 'binary');
  return {
    passphrase,
    pkcs12Bytes: pkcs12Der,
    pkcs12Base64: pkcs12Der.toString('base64'),
    fiscalIdentity,
  };
}
