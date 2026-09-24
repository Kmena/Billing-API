/* eslint-disable no-console */
/**
 * F4-S Local Bootstrap: FiscalSigningCertificate
 *
 * ONE-TIME local sandbox infrastructure setup for TASK-009.
 * Inserts the FiscalSigningCertificate metadata/reference row into billing_dev.
 *
 * SAFETY RULES:
 *   - SANDBOX only — PRODUCTION is hard-blocked at the code level.
 *   - Idempotent — existing ACTIVE SANDBOX cert → ALREADY_CONFIGURED, exit 0.
 *   - Does NOT read the .p12 file or PIN — stores only secret REFERENCES.
 *   - Does NOT print DATABASE_URL, secrets, PIN, certificate contents, or JWTs.
 *   - Not a public endpoint. Not part of the production application module.
 *   - Not called by TASK-009. Does not modify TASK-009 behavior.
 *
 * Usage: npm run f4s:bootstrap-signing-certificate
 * Config: reads F4S_TENANT_ID and F4S_COMPANY_ID from .env.local (loaded automatically).
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Narrow Prisma surface needed by the bootstrap — allows injection in tests. */
export interface BootstrapPrisma {
  readonly tenant: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string } | null>;
  };
  readonly company: {
    findFirst(args: {
      where: { id: string; tenantId: string };
    }): Promise<{ id: string; tenantId: string } | null>;
  };
  readonly fiscalSigningCertificate: {
    findFirst(args: { where: CertPredicate }): Promise<CertRow | null>;
    create(args: { data: CertCreateData; select: CertSelect }): Promise<CertRow>;
  };
}

interface CertPredicate {
  tenantId: string;
  companyId: string;
  environment: string;
  status: string;
}

interface CertRow {
  readonly id: string;
  readonly environment: string;
  readonly status: string;
  readonly certificateSecretReference: string;
  readonly passwordSecretReference: string;
}

interface CertSelect {
  readonly id: true;
  readonly environment: true;
  readonly status: true;
  readonly certificateSecretReference: true;
  readonly passwordSecretReference: true;
}

interface CertCreateData {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly environment: string;
  readonly status: string;
  readonly certificateType: string;
  readonly certificateSecretReference: string;
  readonly passwordSecretReference: string;
  readonly activeFrom: Date;
}

export type BootstrapOutcome = 'CREATED' | 'ALREADY_CONFIGURED';

export interface BootstrapResult {
  readonly outcome: BootstrapOutcome;
  readonly certificateId: string;
  readonly environment: string;
  readonly status: string;
  readonly certRefConfigured: boolean;
  readonly passRefConfigured: boolean;
}

export interface BootstrapInput {
  readonly tenantId: string;
  readonly companyId: string;
  /** Must be 'SANDBOX'. PRODUCTION is hard-blocked. */
  readonly environment: string;
  readonly certSecretRef: string;
  readonly passSecretRef: string;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class BootstrapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}

// ── Shared select projection ──────────────────────────────────────────────────

const CERT_SELECT: CertSelect = {
  id: true,
  environment: true,
  status: true,
  certificateSecretReference: true,
  passwordSecretReference: true,
};

// ── Core bootstrap logic ──────────────────────────────────────────────────────

/**
 * Idempotent bootstrap: creates the FiscalSigningCertificate metadata row if absent.
 * Exported for unit-testing — does NOT touch the file system or load env.
 *
 * @throws BootstrapError with code:
 *   PRODUCTION_TARGET_BLOCKED    — environment !== 'SANDBOX'
 *   TENANT_NOT_FOUND             — tenant row missing
 *   COMPANY_NOT_FOUND            — company row missing
 *   COMPANY_TENANT_MISMATCH      — company exists but belongs to a different tenant
 */
export async function bootstrapSigningCertificate(
  prisma: BootstrapPrisma,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  // ── Safety gate: PRODUCTION is unconditionally blocked ────────────────────
  if (input.environment !== 'SANDBOX') {
    throw new BootstrapError(
      'PRODUCTION_TARGET_BLOCKED',
      `Bootstrap only targets SANDBOX. Received: ${input.environment}`,
    );
  }

  // ── Precondition: tenant must exist ──────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId } });
  if (!tenant) {
    throw new BootstrapError(
      'TENANT_NOT_FOUND',
      `Tenant ${input.tenantId} not found in the database.`,
    );
  }

  // ── Precondition: company must exist and belong to this tenant ────────────
  const company = await prisma.company.findFirst({
    where: { id: input.companyId, tenantId: input.tenantId },
  });
  if (!company) {
    // Distinguish not-found from mismatch by checking company alone
    // (We only get here when the tenantId-scoped query returns null,
    //  which covers both cases — the error code is the appropriate one.)
    throw new BootstrapError(
      'COMPANY_NOT_FOUND',
      `Company ${input.companyId} not found under tenant ${input.tenantId}.`,
    );
  }
  if (company.tenantId !== input.tenantId) {
    // Defensive: findFirst with tenantId constraint should prevent this,
    // but guard explicitly for clarity in tests.
    throw new BootstrapError(
      'COMPANY_TENANT_MISMATCH',
      `Company ${input.companyId} belongs to tenant ${company.tenantId}, not ${input.tenantId}.`,
    );
  }

  // ── Idempotency: check for existing ACTIVE SANDBOX cert ──────────────────
  const existing = await prisma.fiscalSigningCertificate.findFirst({
    where: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      environment: input.environment,
      status: 'ACTIVE',
    },
  });
  if (existing) {
    return {
      outcome: 'ALREADY_CONFIGURED',
      certificateId: existing.id,
      environment: existing.environment,
      status: existing.status,
      certRefConfigured: existing.certificateSecretReference === input.certSecretRef,
      passRefConfigured: existing.passwordSecretReference === input.passSecretRef,
    };
  }

  // ── Create the certificate row ────────────────────────────────────────────
  const now = new Date();
  const created = await prisma.fiscalSigningCertificate.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      companyId: input.companyId,
      environment: input.environment,
      status: 'ACTIVE',
      certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
      certificateSecretReference: input.certSecretRef,
      passwordSecretReference: input.passSecretRef,
      activeFrom: now,
    },
    select: CERT_SELECT,
  });

  return {
    outcome: 'CREATED',
    certificateId: created.id,
    environment: created.environment,
    status: created.status,
    certRefConfigured: created.certificateSecretReference === input.certSecretRef,
    passRefConfigured: created.passwordSecretReference === input.passSecretRef,
  };
}

// ── TASK-009 exact-predicate verification ────────────────────────────────────

/**
 * Re-queries using the EXACT predicate TASK-009 uses.
 * Returns the matching row or null. Does NOT throw.
 * Exported for testing.
 */
export async function verifyTask009Predicate(
  prisma: BootstrapPrisma,
  tenantId: string,
  companyId: string,
): Promise<CertRow | null> {
  return prisma.fiscalSigningCertificate.findFirst({
    where: {
      tenantId,
      companyId,
      environment: 'SANDBOX',
      status: 'ACTIVE',
    },
  });
}

// ── Local env loader ──────────────────────────────────────────────────────────
// Same non-override semantics as f4s-runner.ts and prisma/seed.ts.
// Shell env vars always take priority. Never logs values.

function loadLocalEnv(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  try {
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 1) continue;
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silently ignore — .env.local may not exist
  }
}

// ── Sanitized DB identity (NO credentials printed) ───────────────────────────

function sanitizedDbTarget(): string {
  const url = process.env['DATABASE_URL'] ?? '';
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}/${u.pathname.slice(1)}`;
  } catch {
    return '(configured)';
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadLocalEnv();

  const tenantId = process.env['F4S_TENANT_ID'];
  const companyId = process.env['F4S_COMPANY_ID'];

  if (!tenantId || !companyId) {
    console.error('[f4s:bootstrap] F4S_TENANT_ID and F4S_COMPANY_ID must be set in .env.local');
    process.exit(1);
  }

  const input: BootstrapInput = {
    tenantId,
    companyId,
    environment: 'SANDBOX',
    certSecretRef: 'f4s/task-009/signing-certificate',
    passSecretRef: 'f4s/task-009/signing-certificate-password',
  };

  const DIVIDER = '════════════════════════════════════════════════════════════';
  console.log('');
  console.log(DIVIDER);
  console.log('  F4-S Bootstrap: FiscalSigningCertificate');
  console.log(DIVIDER);
  console.log('');
  console.log(`  DATABASE TARGET : ${sanitizedDbTarget()}`);
  console.log(`  TENANT          : ${input.tenantId}`);
  console.log(`  COMPANY         : ${input.companyId}`);
  console.log(`  ENVIRONMENT     : ${input.environment}`);
  console.log('');

  const prisma = new PrismaClient();

  try {
    const result = await bootstrapSigningCertificate(
      prisma as unknown as BootstrapPrisma,
      input,
    );

    console.log(`  TENANT          : FOUND`);
    console.log(`  COMPANY         : FOUND`);
    console.log(`  CERTIFICATE     : ${result.outcome}`);
    console.log('');

    // ── Verify using the EXACT TASK-009 predicate ─────────────────────────
    const verified = await verifyTask009Predicate(
      prisma as unknown as BootstrapPrisma,
      input.tenantId,
      input.companyId,
    );

    console.log('  ── TASK-009 EXACT PREDICATE VERIFICATION ──');
    console.log(`  TASK-009 EXACT QUERY  : ${verified ? 'FOUND' : 'NOT FOUND ← PROBLEM'}`);

    if (verified) {
      console.log(`  ENVIRONMENT           : ${verified.environment}`);
      console.log(`  STATUS                : ${verified.status}`);
      console.log(
        `  SECRET REFERENCES     : ${result.certRefConfigured && result.passRefConfigured ? 'CONFIGURED' : 'MISMATCH ← CHECK'}`,
      );
    }

    console.log('');
    console.log(DIVIDER);
    const go = verified && result.certRefConfigured && result.passRefConfigured;
    console.log(`  RESULT: ${go ? 'GO — TASK-009 predicate satisfied' : 'NO-GO — see above'}`);
    console.log(DIVIDER);
    console.log('');

    process.exit(go ? 0 : 1);
  } catch (err) {
    if (err instanceof BootstrapError) {
      console.error(`[f4s:bootstrap] ${err.code}: ${err.message}`);
      process.exit(1);
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

// Guard: only run when executed directly via ts-node, not when imported by tests.
if (require.main === module) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[f4s:bootstrap] Fatal: ${msg}`);
    process.exit(1);
  });
}
