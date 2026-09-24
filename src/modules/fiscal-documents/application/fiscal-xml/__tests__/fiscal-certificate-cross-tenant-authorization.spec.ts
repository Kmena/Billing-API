/**
 * fiscal-certificate-cross-tenant-authorization.spec.ts
 *
 * Authorization and cross-tenant isolation tests for certificate metadata and
 * readiness GET endpoints. Proves that:
 *
 *  1. A user from Tenant A CANNOT read certificate metadata for a company
 *     belonging to Tenant B — even if they know the companyId (cross-tenant isolation).
 *
 *  2. A user from Tenant A CAN read certificate metadata for a company in Tenant A
 *     (intra-tenant read — any authenticated user, current policy).
 *
 *  3. FiscalReadinessService enforces the same tenant scoping — cross-tenant
 *     queries always return no results (readyToIssue: false, no cert metadata).
 *
 *  4. FiscalReadCertificateMetadataService throws FiscalCertificateNotFoundForReadException
 *     (404) for cross-tenant requests (the certificate simply does not exist
 *     for the requesting tenant).
 *
 *  5. Tenant scoping is enforced by including tenantId from the JWT in every
 *     DB query — never by trusting a client-supplied tenant value.
 *
 * AC-013, AC-025, AC-026, FR-024
 */

import { FiscalReadCertificateMetadataService } from '../fiscal-read-certificate-metadata.service';
import { FiscalReadinessService } from '../fiscal-readiness.service';
import { FiscalCertificateNotFoundForReadException } from '../../../domain/fiscal-xml/exceptions/fiscal-certificate.exceptions';

// ── Tenant / company fixtures ─────────────────────────────────────────────────

/** Tenant A owns Company A. */
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';

/** Tenant B owns Company B. */
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';

const ENV = 'SANDBOX';

/** Safe ACTIVE certificate belonging to Tenant B / Company B. */
const CERT_B = {
  id: 'cert-b-id',
  tenantId: TENANT_B,
  companyId: COMPANY_B,
  environment: ENV,
  status: 'ACTIVE',
  fingerprintSha256: 'b'.repeat(64),
  serialNumber: 'SN-B',
  subjectName: 'CN=Company B',
  issuerName: 'CN=CR CA',
  validFrom: new Date('2026-01-01'),
  validTo: new Date('2027-01-01'),
  extractedIdentityNumber: '3001234567',
  extractedIdentityType: '01',
  activeFrom: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-09-24'),
};

/** Safe ACTIVE certificate belonging to Tenant A / Company A. */
const CERT_A = {
  ...CERT_B,
  id: 'cert-a-id',
  tenantId: TENANT_A,
  companyId: COMPANY_A,
  fingerprintSha256: 'a'.repeat(64),
  serialNumber: 'SN-A',
  subjectName: 'CN=Company A',
  extractedIdentityNumber: '3102123456',
};

// ── Prisma mock helpers ───────────────────────────────────────────────────────

/**
 * Build a Prisma mock whose fiscalSigningCertificate.findFirst respects
 * (tenantId, companyId) scoping — mirroring the real DB behaviour.
 */
function makePrismaMock(certs: (typeof CERT_A)[]) {
  return {
    fiscalSigningCertificate: {
      findFirst: jest
        .fn()
        .mockImplementation(
          (args: {
            where: { tenantId?: string; companyId?: string; environment?: string; status?: string };
          }) => {
            const { tenantId, companyId, environment, status } = args.where;
            const match = certs.find(
              (c) =>
                (tenantId === undefined || c.tenantId === tenantId) &&
                (companyId === undefined || c.companyId === companyId) &&
                (environment === undefined || c.environment === environment) &&
                (status === undefined || c.status === status),
            );
            return Promise.resolve(match ?? null);
          },
        ),
    },
    companyFiscalProfile: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    haciendaConnection: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    company: {
      findFirst: jest
        .fn()
        .mockImplementation((args: { where: { id?: string; tenantId?: string } }) => {
          if (args.where.id === COMPANY_A && args.where.tenantId === TENANT_A) {
            return Promise.resolve({ identificationNumber: '3102123456' });
          }
          if (args.where.id === COMPANY_B && args.where.tenantId === TENANT_B) {
            return Promise.resolve({ identificationNumber: '3001234567' });
          }
          return Promise.resolve(null);
        }),
    },
    fiscalIssuancePoint: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

// ── FiscalReadCertificateMetadataService cross-tenant tests ───────────────────

describe('FiscalReadCertificateMetadataService — cross-tenant isolation (AC-013, FR-024)', () => {
  it('returns 404 when User from Tenant A requests Company B certificate', async () => {
    // Tenant A user knows Company B's companyId (e.g. from a leaked ID).
    // The service must NOT return Tenant B's certificate data.
    const prisma = makePrismaMock([CERT_A, CERT_B]);
    const service = new FiscalReadCertificateMetadataService(prisma as never);

    // Request uses Tenant A's tenantId (from JWT) but Company B's companyId (from URL).
    // The DB query WHERE (tenantId=A AND companyId=B) returns nothing.
    await expect(
      service.execute({ tenantId: TENANT_A, companyId: COMPANY_B, environment: ENV }),
    ).rejects.toBeInstanceOf(FiscalCertificateNotFoundForReadException);

    // Verify the query included tenantId from JWT, not a tenant-free lookup
    expect(prisma.fiscalSigningCertificate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT_A, companyId: COMPANY_B }),
      }),
    );
  });

  it('returns certificate when User from Tenant A requests own Company A certificate', async () => {
    const prisma = makePrismaMock([CERT_A, CERT_B]);
    const service = new FiscalReadCertificateMetadataService(prisma as never);

    const result = await service.execute({
      tenantId: TENANT_A,
      companyId: COMPANY_A,
      environment: ENV,
    });

    expect(result.id).toBe('cert-a-id');
    expect(result.companyId).toBe(COMPANY_A);
    // Secret references must NOT be present in the result
    expect(Object.keys(result)).not.toContain('certificateSecretReference');
    expect(Object.keys(result)).not.toContain('passwordSecretReference');
  });

  it('returns 404 when User from Tenant B requests Company A certificate (reversed direction)', async () => {
    const prisma = makePrismaMock([CERT_A, CERT_B]);
    const service = new FiscalReadCertificateMetadataService(prisma as never);

    await expect(
      service.execute({ tenantId: TENANT_B, companyId: COMPANY_A, environment: ENV }),
    ).rejects.toBeInstanceOf(FiscalCertificateNotFoundForReadException);
  });

  it('AC-026: certificate from a different tenant is completely ignored even when companyId matches', async () => {
    // Edge case: Company C in Tenant B happens to have the same companyId UUID
    // as Company A in Tenant A (which should never occur in production with UUID4,
    // but proves the tenantId guard is enforced independently).
    // Modelled by querying with a tenantId that owns no certificate.
    const TENANT_C = 'cccccccc-cccc-4ccc-8ccc-000000000001';
    const prisma = makePrismaMock([CERT_A]);
    const service = new FiscalReadCertificateMetadataService(prisma as never);

    await expect(
      service.execute({ tenantId: TENANT_C, companyId: COMPANY_A, environment: ENV }),
    ).rejects.toBeInstanceOf(FiscalCertificateNotFoundForReadException);
  });
});

// ── FiscalReadinessService cross-tenant tests ─────────────────────────────────

describe('FiscalReadinessService — cross-tenant isolation (AC-013, FR-024)', () => {
  it('returns readyToIssue: false with ACTIVE_CERTIFICATE_MISSING when User from Tenant A requests Company B readiness', async () => {
    // User from Tenant A cannot see Tenant B's certificate — the readiness check
    // behaves as if no certificate exists for the requested scope.
    const prisma = makePrismaMock([CERT_B]);
    const service = new FiscalReadinessService(prisma as never);

    const result = await service.evaluate({
      tenantId: TENANT_A,
      companyId: COMPANY_B,
      environment: ENV,
    });

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('ACTIVE_CERTIFICATE_MISSING');
    // The result must not include any certificate metadata from Tenant B
    expect(result.activeCertificate).toBeNull();
  });

  it('returns certificate metadata when tenant scoping matches own company', async () => {
    const prisma = makePrismaMock([CERT_A, CERT_B]);
    const service = new FiscalReadinessService(prisma as never);

    const result = await service.evaluate({
      tenantId: TENANT_A,
      companyId: COMPANY_A,
      environment: ENV,
    });

    // Certificate found — identity check will run but may still not be ready
    // (due to missing haciendaConnection and issuancePoint in the mock)
    expect(result.activeCertificate).not.toBeNull();
    expect(result.activeCertificate?.id).toBe('cert-a-id');
    // Secret references must NOT appear anywhere in the result
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('certificateSecretReference');
    expect(serialized).not.toContain('passwordSecretReference');
  });

  it('readiness response never exposes secret fields regardless of tenant', async () => {
    const prisma = makePrismaMock([CERT_A]);
    const service = new FiscalReadinessService(prisma as never);

    const result = await service.evaluate({
      tenantId: TENANT_A,
      companyId: COMPANY_A,
      environment: ENV,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('certificateSecretReference');
    expect(serialized).not.toContain('passwordSecretReference');
    expect(serialized).not.toContain('pkcs12');
    expect(serialized).not.toContain('passphrase');
  });
});

// ── Authorization model documentation ────────────────────────────────────────
//
// TASK-012 (P1 deferred) — Within-tenant authorization granularity:
//
//   Current policy: Any authenticated JWT (any role) can read certificate
//   metadata and fiscal readiness for ANY company within the same tenant.
//   This is enforced purely by tenantId scoping (from JWT), not by company
//   membership.
//
//   Cross-tenant isolation: PROVEN above — tenantId from JWT + companyId from
//   URL means a user from Tenant A can never read Tenant B's certificate data.
//   The DB query returns nothing → 404.
//
//   Within-tenant gap: A MEMBER of Company X in Tenant A can currently read
//   Company Y's certificate metadata (also in Tenant A). This returns only
//   safe metadata (fingerprint, serial, subject, validity dates — no secrets).
//   This gap is classified as TASK-012 (P1) and documented as a known limitation.
//
//   Write operations (POST/PUT certificate, PUT company) already require
//   TENANT_ADMIN role — those authorization boundaries are properly enforced.
//
