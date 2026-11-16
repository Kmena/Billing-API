import * as request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { FiscalDocument } from '@prisma/client';
import {
  authorizeApiKeyForCompany,
  configureDefaultFiscalSetup,
  configureValidCompanyFiscalProfile,
  createEnabledHaciendaConnection,
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  fiscalInvoicePayload,
  resetFiscalE2eData,
  type FiscalApiKeyFixture,
  type FiscalE2eContext,
  type FiscalTenantFixture,
} from '../../helpers/fiscal-e2e-helpers';
import { createTestCompany } from '../../helpers/test-factories';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../src/infrastructure/secrets/ports/secret-provider.port';
import { STORAGE_PORT, StoragePort } from '../../../src/infrastructure/storage/ports/storage.port';
import {
  XML_SIGNER,
  XmlSignerPort,
} from '../../../src/infrastructure/signing/ports/xml-signer.port';
import {
  XSD_VALIDATOR,
  XsdValidatorPort,
} from '../../../src/modules/fiscal-documents/application/fiscal-xml/xsd-validator.port';
import { createTestSigningMaterial } from '../../../src/modules/fiscal-documents/domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';

jest.setTimeout(180000);

const signingMaterial = createTestSigningMaterial();
const notePath = (companyId: string, kind: 'credit-notes' | 'debit-notes') =>
  `/api/v1/lab/companies/${companyId}/fiscal-documents/SANDBOX/${kind}`;
const noteBody = (sourceDocumentId: string) => ({
  sourceDocumentId,
  referenceCode: '01',
  reason: 'Ajuste sintético exclusivo de laboratorio',
});
const noteLines = [
  {
    lineNumber: 1,
    cabysCode: '8313100000100',
    description: 'Cargo sintético adicional',
    unitMeasure: 'Sp',
    quantity: '1.00000',
    unitPrice: '100.00000',
    taxAmount: '13.00000',
    taxCode: '01',
    taxRateCode: '08',
    taxRate: '13.00000',
  },
];

async function configureCertificate(context: FiscalE2eContext, fixture: FiscalTenantFixture) {
  const certificateSecretReference = `R3_CERT_${fixture.companyId.replace(/-/g, '_')}`;
  const passwordSecretReference = `R3_PASS_${fixture.companyId.replace(/-/g, '_')}`;
  const secrets = context.app.get<SecretProvider>(SECRET_PROVIDER);
  await secrets.storeSecret(
    certificateSecretReference,
    JSON.stringify({ pkcs12Base64: signingMaterial.pkcs12Base64 }),
  );
  await secrets.storeSecret(passwordSecretReference, signingMaterial.certificate.passphrase);
  await context.prisma.fiscalSigningCertificate.create({
    data: {
      id: randomUUID(),
      tenantId: fixture.tenantId,
      companyId: fixture.companyId,
      environment: 'SANDBOX',
      status: 'ACTIVE',
      certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
      certificateSecretReference,
      passwordSecretReference,
      fingerprintSha256: createHash('sha256')
        .update(Buffer.from(signingMaterial.certificateDerBase64, 'base64'))
        .digest('hex'),
      serialNumber: signingMaterial.x509SerialNumber,
      subjectName: signingMaterial.x509Subject,
      issuerName: 'CN=R3 Synthetic CA',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2027-01-01T00:00:00.000Z'),
      extractedIdentityNumber: fixture.companyIdentification,
    },
  });
}

async function setupIssuer(context: FiscalE2eContext, fixture: FiscalTenantFixture) {
  await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
  await configureValidCompanyFiscalProfile(context, fixture);
  await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
  await configureCertificate(context, fixture);
  const key = await createFiscalApiKey(context.prisma, fixture.tenantId, [
    'invoices:write',
    'invoices:read',
    'credit-notes:write',
    'credit-notes:read',
    'debit-notes:write',
    'debit-notes:read',
  ]);
  await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);
  return key;
}

async function createAcceptedSource(
  context: FiscalE2eContext,
  fixture: FiscalTenantFixture,
  key: FiscalApiKeyFixture,
): Promise<FiscalDocument> {
  const payload = fiscalInvoicePayload(fixture.companyId);
  payload.lines[0].cabysCode = '8313100000100';
  const created = await request(context.app.getHttpServer())
    .post('/api/v1/invoices')
    .set('X-API-Key', key.secret)
    .set('Idempotency-Key', randomUUID())
    .send(payload)
    .expect(201);
  await request(context.app.getHttpServer())
    .post(`/api/v1/fiscal-documents/${created.body.id}/prepare-xml`)
    .set('X-API-Key', key.secret)
    .expect(201);
  // Simulate acceptance only inside the disposable database; no Hacienda request.
  return context.prisma.fiscalDocument.update({
    where: { id: created.body.id },
    data: { status: 'ACCEPTED' },
  });
}

describe('W4-B-R3 corrective notes M2M (disposable PostgreSQL)', () => {
  let context: FiscalE2eContext;
  let companyA: FiscalTenantFixture;
  let companyB: FiscalTenantFixture;
  let keyA: FiscalApiKeyFixture;
  let keyB: FiscalApiKeyFixture;
  let sourceA: FiscalDocument;
  let sourceB: FiscalDocument;
  let creditId: string;
  let creditKey: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp({ correctiveLab: true });
    companyA = await createFiscalTenantFixture(context);
    const second = await createTestCompany(context.prisma, companyA.tenantId);
    companyB = {
      ...companyA,
      companyId: second.id,
      companyIdentification: second.identificationNumber,
    };
    keyA = await setupIssuer(context, companyA);
    keyB = await setupIssuer(context, companyB);
    sourceA = await createAcceptedSource(context, companyA, keyA);
    sourceB = await createAcceptedSource(context, companyB, keyB);
  });

  afterAll(async () => {
    if (context) {
      await resetFiscalE2eData(context);
      await context.prisma.$disconnect();
      await context.app.close();
    }
  });

  it('matches the applied migration checksums in the disposable database', async () => {
    const rows = await context.prisma.$queryRawUnsafe<
      Array<{ migration_name: string; checksum: string }>
    >('SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL');
    expect(rows).toHaveLength(34);
    for (const name of [
      '20261111090000_lab_corrective_note_types',
      '20261111100000_lab_corrective_notes',
    ]) {
      const bytes = readFileSync(
        join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'),
      );
      const checksum = createHash('sha256').update(bytes).digest('hex');
      expect(rows.find((row) => row.migration_name === name)?.checksum).toBe(checksum);
    }
  });

  it('persists NC and ND, serves POST/GET/by-key, audits, and validates signed XML', async () => {
    creditKey = `r3-credit-${randomUUID()}`;
    const credit = await request(context.app.getHttpServer())
      .post(notePath(companyA.companyId, 'credit-notes'))
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', creditKey)
      .send(noteBody(sourceA.id))
      .expect(201);
    creditId = credit.body.id as string;
    expect(credit.body).toMatchObject({
      type: 'CREDIT_NOTE',
      status: 'READY_FOR_XML',
      sourceFiscalDocumentId: sourceA.id,
    });
    expect(credit.body.consecutive).toMatch(/^0010000103\d{10}$/);
    expect(credit.body.receiverSnapshot).toEqual(sourceA.receiverSnapshot);
    expect(credit.body.lines).toEqual(sourceA.lines);
    expect(credit.body.totals).toEqual(sourceA.totals);

    const byId = await request(context.app.getHttpServer())
      .get(`${notePath(companyA.companyId, 'credit-notes')}/${creditId}`)
      .set('X-API-Key', keyA.secret)
      .expect(200);
    const byKey = await request(context.app.getHttpServer())
      .get(`${notePath(companyA.companyId, 'credit-notes')}/by-key/${creditKey}`)
      .set('X-API-Key', keyA.secret)
      .expect(200);
    expect(byId.body.id).toBe(creditId);
    expect(byKey.body.id).toBe(creditId);

    const signed = await request(context.app.getHttpServer())
      .post(`${notePath(companyA.companyId, 'credit-notes')}/${creditId}/prepare-xml`)
      .set('X-API-Key', keyA.secret)
      .expect(201);
    expect(signed.body.status).toBe('XML_VALIDATED');
    const artifact = await context.prisma.fiscalXmlArtifact.findFirstOrThrow({
      where: { fiscalDocumentId: creditId },
    });
    const storage = context.app.get<StoragePort>(STORAGE_PORT);
    const bytes = await storage.download(artifact.signedXmlStorageKey ?? '');
    const xml = bytes.toString('utf8');
    const signer = context.app.get<XmlSignerPort>(XML_SIGNER);
    const validator = context.app.get<XsdValidatorPort>(XSD_VALIDATOR);
    expect((await signer.verify(xml)).isValid).toBe(true);
    expect(
      validator.validate({
        xml,
        documentType: 'CREDIT_NOTE',
        rootElement: 'NotaCreditoElectronica',
        schemaVersion: 'v4.4',
        namespace:
          'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica',
      }).isValid,
    ).toBe(true);
    expect(
      await context.prisma.fiscalSubmission.count({ where: { fiscalDocumentId: creditId } }),
    ).toBe(0);
    expect(
      await context.prisma.fiscalNoteAudit.count({ where: { fiscalDocumentId: creditId } }),
    ).toBeGreaterThanOrEqual(3);

    const debitKey = `r3-debit-${randomUUID()}`;
    const debit = await request(context.app.getHttpServer())
      .post(notePath(companyA.companyId, 'debit-notes'))
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', debitKey)
      .send({ ...noteBody(sourceA.id), lines: noteLines })
      .expect(201);
    expect(debit.body).toMatchObject({
      type: 'DEBIT_NOTE',
      status: 'READY_FOR_XML',
      sourceFiscalDocumentId: sourceA.id,
    });
    expect(debit.body.consecutive).toMatch(/^0010000102\d{10}$/);
    expect(
      (
        await request(context.app.getHttpServer())
          .get(`${notePath(companyA.companyId, 'debit-notes')}/${debit.body.id}`)
          .set('X-API-Key', keyA.secret)
          .expect(200)
      ).body.id,
    ).toBe(debit.body.id);
    expect(
      (
        await request(context.app.getHttpServer())
          .get(`${notePath(companyA.companyId, 'debit-notes')}/by-key/${debitKey}`)
          .set('X-API-Key', keyA.secret)
          .expect(200)
      ).body.id,
    ).toBe(debit.body.id);
    const preparedDebit = await request(context.app.getHttpServer())
      .post(`${notePath(companyA.companyId, 'debit-notes')}/${debit.body.id}/prepare-xml`)
      .set('X-API-Key', keyA.secret)
      .expect(201);
    expect(preparedDebit.body.status).toBe('XML_VALIDATED');
    const debitArtifact = await context.prisma.fiscalXmlArtifact.findFirstOrThrow({
      where: { fiscalDocumentId: debit.body.id },
    });
    const debitXml = (await storage.download(debitArtifact.signedXmlStorageKey ?? '')).toString(
      'utf8',
    );
    expect((await signer.verify(debitXml)).isValid).toBe(true);
    expect(
      validator.validate({
        xml: debitXml,
        documentType: 'DEBIT_NOTE',
        rootElement: 'NotaDebitoElectronica',
        schemaVersion: 'v4.4',
        namespace:
          'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaDebitoElectronica',
      }).isValid,
    ).toBe(true);
  });

  it('replays committed requests and rejects changed payload or a second total NC', async () => {
    const path = notePath(companyA.companyId, 'credit-notes');
    const replay = await request(context.app.getHttpServer())
      .post(path)
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', creditKey)
      .send(noteBody(sourceA.id))
      .expect(201);
    expect(replay.body.id).toBe(creditId);
    await request(context.app.getHttpServer())
      .post(path)
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', creditKey)
      .send({ ...noteBody(sourceA.id), reason: 'Otra razón sintética' })
      .expect(409);
    await request(context.app.getHttpServer())
      .post(path)
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', randomUUID())
      .send(noteBody(sourceA.id))
      .expect(409);
    expect(
      await context.prisma.fiscalDocument.count({
        where: { sourceFiscalDocumentId: sourceA.id, type: 'CREDIT_NOTE' },
      }),
    ).toBe(1);
    const sequence = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { companyId: companyA.companyId, documentType: 'CREDIT_NOTE' },
    });
    expect(sequence.lastAssigned).toBe(1n);
  });

  it('serializes simultaneous keys on one source without duplicate NC or consecutive', async () => {
    const source = await createAcceptedSource(context, companyA, keyA);
    const path = notePath(companyA.companyId, 'credit-notes');
    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .post(path)
        .set('X-API-Key', keyA.secret)
        .set('Idempotency-Key', randomUUID())
        .send(noteBody(source.id)),
      request(context.app.getHttpServer())
        .post(path)
        .set('X-API-Key', keyA.secret)
        .set('Idempotency-Key', randomUUID())
        .send(noteBody(source.id)),
    ]);
    expect(responses.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(
      await context.prisma.fiscalDocument.count({
        where: { sourceFiscalDocumentId: source.id, type: 'CREDIT_NOTE' },
      }),
    ).toBe(1);
    const debitResponses = await Promise.all([
      request(context.app.getHttpServer())
        .post(notePath(companyA.companyId, 'debit-notes'))
        .set('X-API-Key', keyA.secret)
        .set('Idempotency-Key', randomUUID())
        .send({ ...noteBody(source.id), lines: noteLines }),
      request(context.app.getHttpServer())
        .post(notePath(companyA.companyId, 'debit-notes'))
        .set('X-API-Key', keyA.secret)
        .set('Idempotency-Key', randomUUID())
        .send({ ...noteBody(source.id), lines: noteLines }),
    ]);
    expect(debitResponses.map((item) => item.status)).toEqual([201, 201]);
    expect(new Set(debitResponses.map((item) => item.body.consecutive)).size).toBe(2);
  });

  it('recovers concurrent identical keys and rejects invalid reference codes before allocation', async () => {
    const source = await createAcceptedSource(context, companyA, keyA);
    const path = notePath(companyA.companyId, 'credit-notes');
    const key = `r3-concurrent-${randomUUID()}`;
    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .post(path)
        .set('X-API-Key', keyA.secret)
        .set('Idempotency-Key', key)
        .send(noteBody(source.id)),
      request(context.app.getHttpServer())
        .post(path)
        .set('X-API-Key', keyA.secret)
        .set('Idempotency-Key', key)
        .send(noteBody(source.id)),
    ]);
    expect(responses.every((item) => item.status === 201 || item.status === 409)).toBe(true);
    const recovered = await request(context.app.getHttpServer())
      .get(`${path}/by-key/${key}`)
      .set('X-API-Key', keyA.secret)
      .expect(200);
    for (const response of responses.filter((item) => item.status === 201)) {
      expect(response.body.id).toBe(recovered.body.id);
    }
    expect(
      await context.prisma.fiscalDocument.count({
        where: { sourceFiscalDocumentId: source.id, type: 'CREDIT_NOTE' },
      }),
    ).toBe(1);

    const sequenceBefore = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { companyId: companyA.companyId, documentType: 'DEBIT_NOTE' },
    });
    await request(context.app.getHttpServer())
      .post(notePath(companyA.companyId, 'debit-notes'))
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', randomUUID())
      .send({ ...noteBody(source.id), referenceCode: '00', lines: noteLines })
      .expect(400);
    const sequenceAfter = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { companyId: companyA.companyId, documentType: 'DEBIT_NOTE' },
    });
    expect(sequenceAfter.nextValue).toBe(sequenceBefore.nextValue);
  });

  it('isolates companies and rejects missing authorization and mismatched issuer', async () => {
    const bKey = `r3-b-${randomUUID()}`;
    const bNote = await request(context.app.getHttpServer())
      .post(notePath(companyB.companyId, 'credit-notes'))
      .set('X-API-Key', keyB.secret)
      .set('Idempotency-Key', bKey)
      .send(noteBody(sourceB.id))
      .expect(201);
    await request(context.app.getHttpServer())
      .get(`${notePath(companyB.companyId, 'credit-notes')}/${bNote.body.id}`)
      .set('X-API-Key', keyA.secret)
      .expect(403);
    await request(context.app.getHttpServer())
      .get(`${notePath(companyB.companyId, 'credit-notes')}/by-key/${bKey}`)
      .set('X-API-Key', keyA.secret)
      .expect(403);
    await request(context.app.getHttpServer())
      .post(notePath(companyA.companyId, 'credit-notes'))
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', randomUUID())
      .send(noteBody(sourceB.id))
      .expect(404);
    await request(context.app.getHttpServer())
      .post(notePath(companyB.companyId, 'credit-notes'))
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', randomUUID())
      .send(noteBody(sourceB.id))
      .expect(403);
    await request(context.app.getHttpServer())
      .get(`${notePath(companyA.companyId, 'credit-notes')}/${creditId}`)
      .expect(401);
    const readOnly = await createFiscalApiKey(context.prisma, companyA.tenantId, [
      'credit-notes:read',
    ]);
    await authorizeApiKeyForCompany(context.prisma, readOnly.id, companyA.companyId);
    await request(context.app.getHttpServer())
      .post(notePath(companyA.companyId, 'credit-notes'))
      .set('X-API-Key', readOnly.secret)
      .set('Idempotency-Key', randomUUID())
      .send(noteBody(sourceA.id))
      .expect(403);
    await request(context.app.getHttpServer())
      .get(`${notePath(companyA.companyId, 'debit-notes')}/by-key/${bKey}`)
      .set('X-API-Key', readOnly.secret)
      .expect(403);
    const allowedRead = await request(context.app.getHttpServer())
      .get(`${notePath(companyA.companyId, 'credit-notes')}/${creditId}`)
      .set('X-API-Key', readOnly.secret)
      .expect(200);
    expect(JSON.stringify(allowedRead.body)).not.toContain(readOnly.secret);

    const wrongIssuerSource = await createAcceptedSource(context, companyA, keyA);
    await context.prisma.fiscalDocument.update({
      where: { id: wrongIssuerSource.id },
      data: { issuerSnapshot: { identificationNumber: '3999999999' } },
    });
    await request(context.app.getHttpServer())
      .post(notePath(companyA.companyId, 'credit-notes'))
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', randomUUID())
      .send(noteBody(wrongIssuerSource.id))
      .expect(409);
  });

  it('keeps one identity through signing and XSD failures, then retries safely', async () => {
    const source = await createAcceptedSource(context, companyA, keyA);
    const path = notePath(companyA.companyId, 'debit-notes');
    const key = `r3-fault-${randomUUID()}`;
    const created = await request(context.app.getHttpServer())
      .post(path)
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', key)
      .send({ ...noteBody(source.id), lines: noteLines })
      .expect(201);
    const certificate = await context.prisma.fiscalSigningCertificate.findFirstOrThrow({
      where: { companyId: companyA.companyId, environment: 'SANDBOX', status: 'ACTIVE' },
    });
    const secrets = context.app.get<SecretProvider>(SECRET_PROVIDER);
    const passphrase = await secrets.getSecret(certificate.passwordSecretReference);
    try {
      await secrets.storeSecret(certificate.passwordSecretReference, 'wrong-synthetic-passphrase');
      const failed = await request(context.app.getHttpServer())
        .post(`${path}/${created.body.id}/prepare-xml`)
        .set('X-API-Key', keyA.secret);
      expect(failed.status).toBeGreaterThanOrEqual(400);
    } finally {
      await secrets.storeSecret(certificate.passwordSecretReference, passphrase);
    }
    const retry = await request(context.app.getHttpServer())
      .post(`${path}/${created.body.id}/prepare-xml`)
      .set('X-API-Key', keyA.secret)
      .expect(201);
    expect(retry.body.status).toBe('XML_VALIDATED');
    expect(
      (
        await request(context.app.getHttpServer())
          .get(`${path}/by-key/${key}`)
          .set('X-API-Key', keyA.secret)
          .expect(200)
      ).body.id,
    ).toBe(created.body.id);

    const xsdSource = await createAcceptedSource(context, companyA, keyA);
    const xsdCreated = await request(context.app.getHttpServer())
      .post(path)
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', randomUUID())
      .send({ ...noteBody(xsdSource.id), lines: noteLines })
      .expect(201);
    const document = await context.prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: xsdCreated.body.id },
    });
    await context.prisma.fiscalDocument.update({
      where: { id: document.id },
      // JavaScript parses this normalized date, but xs:dateTime rejects 30 February.
      data: {
        referenceSnapshot: {
          ...(document.referenceSnapshot as object),
          issueDate: '2026-02-30T10:20:30-06:00',
        },
      },
    });
    const invalid = await request(context.app.getHttpServer())
      .post(`${path}/${document.id}/prepare-xml`)
      .set('X-API-Key', keyA.secret);
    expect(invalid.status).toBe(400);
    const failedArtifact = await context.prisma.fiscalXmlArtifact.findFirstOrThrow({
      where: { fiscalDocumentId: document.id },
    });
    expect(failedArtifact.xsdValidationStatus).toBe('INVALID');
    await context.prisma.fiscalDocument.update({
      where: { id: document.id },
      data: { referenceSnapshot: document.referenceSnapshot as never },
    });
    const repaired = await request(context.app.getHttpServer())
      .post(`${path}/${document.id}/prepare-xml`)
      .set('X-API-Key', keyA.secret)
      .expect(201);
    expect(repaired.body.status).toBe('XML_VALIDATED');
    expect(await context.prisma.fiscalDocument.count({ where: { id: created.body.id } })).toBe(1);
    expect(await context.prisma.fiscalDocument.count({ where: { id: document.id } })).toBe(1);
  });

  it('recovers after a temporary disconnect of only the labeled lab database', async () => {
    const runId = process.env.BILLING_TEST_RUN_ID;
    expect(runId).toMatch(/^p0[a-f0-9]{12}$/);
    const container = `billing-p0-${runId}`;
    const labels = execFileSync(
      'docker',
      [
        'inspect',
        '--format',
        '{{ index .Config.Labels "com.billing.test-run-id" }}|{{ index .Config.Labels "com.billing.test-safety" }}',
        container,
      ],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    expect(labels).toBe(`${runId}|true`);
    execFileSync('docker', ['pause', container], { windowsHide: true });
    try {
      let interrupted = false;
      let status = 0;
      try {
        const response = await request(context.app.getHttpServer())
          .get(`${notePath(companyA.companyId, 'credit-notes')}/by-key/${creditKey}`)
          .set('X-API-Key', keyA.secret)
          .timeout({ deadline: 1000 });
        status = response.status;
      } catch {
        interrupted = true;
      }
      expect(interrupted || status >= 500).toBe(true);
    } finally {
      execFileSync('docker', ['unpause', container], { windowsHide: true });
    }
    const recovered = await request(context.app.getHttpServer())
      .get(`${notePath(companyA.companyId, 'credit-notes')}/by-key/${creditKey}`)
      .set('X-API-Key', keyA.secret)
      .expect(200);
    expect(recovered.body.id).toBe(creditId);
    expect(await context.prisma.fiscalDocument.count({ where: { id: creditId } })).toBe(1);
  });

  it('recovers an interrupted POST without assigning a second fiscal identity', async () => {
    const source = await createAcceptedSource(context, companyA, keyA);
    const path = notePath(companyA.companyId, 'debit-notes');
    const key = `r3-interrupted-${randomUUID()}`;
    const runId = process.env.BILLING_TEST_RUN_ID;
    const container = `billing-p0-${runId}`;
    const label = execFileSync(
      'docker',
      ['inspect', '--format', '{{ index .Config.Labels "com.billing.test-run-id" }}', container],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    expect(label).toBe(runId);
    execFileSync('docker', ['pause', container], { windowsHide: true });
    try {
      await expect(
        request(context.app.getHttpServer())
          .post(path)
          .set('X-API-Key', keyA.secret)
          .set('Idempotency-Key', key)
          .send({ ...noteBody(source.id), lines: noteLines })
          .timeout({ deadline: 1000 }),
      ).rejects.toBeDefined();
    } finally {
      execFileSync('docker', ['unpause', container], { windowsHide: true });
    }
    let recoveredId: string | undefined;
    for (let attempt = 0; attempt < 20 && !recoveredId; attempt += 1) {
      const lookup = await request(context.app.getHttpServer())
        .get(`${path}/by-key/${key}`)
        .set('X-API-Key', keyA.secret);
      if (lookup.status === 200) recoveredId = lookup.body.id as string;
      else expect([404, 409]).toContain(lookup.status);
      if (!recoveredId) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const retry = await request(context.app.getHttpServer())
      .post(path)
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', key)
      .send({ ...noteBody(source.id), lines: noteLines })
      .expect(201);
    if (recoveredId) expect(retry.body.id).toBe(recoveredId);
    expect(
      await context.prisma.fiscalDocument.count({
        where: { sourceFiscalDocumentId: source.id, type: 'DEBIT_NOTE' },
      }),
    ).toBe(1);
  });

  it('does not manufacture a document from an unknown in-progress reservation', async () => {
    const key = `r3-unknown-${randomUUID()}`;
    await context.prisma.fiscalIdempotencyKey.create({
      data: {
        id: randomUUID(),
        tenantId: companyA.tenantId,
        companyId: companyA.companyId,
        apiKeyId: keyA.id,
        operation: 'fiscal-document.create.debit_note',
        key,
        requestHash: 'a'.repeat(64),
        status: 'IN_PROGRESS',
      },
    });
    const response = await request(context.app.getHttpServer())
      .get(`${notePath(companyA.companyId, 'debit-notes')}/by-key/${key}`)
      .set('X-API-Key', keyA.secret)
      .expect(409);
    expect(response.body.error.code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    expect(
      await context.prisma.fiscalDocument.count({
        where: { tenantId: companyA.tenantId, companyId: companyA.companyId, idempotencyKey: key },
      }),
    ).toBe(0);
  });

  it('recovers the same fiscal identity after API restart', async () => {
    const owned = [...context.ownedTenantIds];
    await context.app.close();
    await context.prisma.$disconnect();
    context = await createFiscalE2eApp({ correctiveLab: true });
    for (const tenantId of owned) context.ownedTenantIds.add(tenantId);
    const recovered = await request(context.app.getHttpServer())
      .get(`${notePath(companyA.companyId, 'credit-notes')}/by-key/${creditKey}`)
      .set('X-API-Key', keyA.secret)
      .expect(200);
    expect(recovered.body.id).toBe(creditId);
    expect(recovered.body.clave).toMatch(/^506\d{47}$/);
    expect(await context.prisma.fiscalDocument.count({ where: { id: creditId } })).toBe(1);
  });
});
