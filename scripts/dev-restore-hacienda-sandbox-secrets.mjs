/**
 * Restore the three existing Hacienda SANDBOX secret references in LocalStack.
 *
 * LOCAL DEVELOPMENT ONLY. Reads gitignored .env.local and .secrets material.
 * It never contacts Hacienda, never changes Billing database rows, and never
 * overwrites an SSM parameter that already exists.
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { PrismaClient } from '@prisma/client';
import {
  GetParametersCommand,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';

const require = createRequire(import.meta.url);
const {
  loadLocalSecretEnv,
  requireHaciendaSandboxCredentials,
  requireLocalSecret,
} = require('./local-secret-env.cjs');

const LOCALSTACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function assertLocalStackEndpoint(rawEndpoint) {
  const endpoint = new URL(rawEndpoint);
  if (
    endpoint.protocol !== 'http:' ||
    !LOCALSTACK_HOSTS.has(endpoint.hostname) ||
    endpoint.port !== '4566'
  ) {
    throw new Error('AWS_SSM_ENDPOINT must be the local LocalStack endpoint on port 4566.');
  }
  return endpoint;
}

export function buildExpectedReferences(companyId, fingerprint) {
  return {
    connection: `hacienda-conn/${companyId}/SANDBOX`,
    certificate: `fiscal-certs/${companyId}/sandbox/cert-${fingerprint}`,
    pin: `fiscal-certs/${companyId}/sandbox/pin-${fingerprint}`,
  };
}

export function assessParameterState(names, response) {
  const found = new Set((response.Parameters ?? []).map((parameter) => parameter.Name));
  const missing = new Set(response.InvalidParameters ?? []);
  if (found.size === 0 && missing.size === names.length && names.every((name) => missing.has(name))) {
    return 'RESTORE';
  }
  throw new Error('LocalStack SSM parameter state conflicts with safe create-only recovery.');
}

function parameterName(prefix, reference) {
  return `${prefix.replace(/\/$/, '')}/${reference}`;
}

async function main() {
  loadLocalSecretEnv();

  const endpoint = assertLocalStackEndpoint(requireLocalSecret('AWS_SSM_ENDPOINT'));
  const prefix = process.env.SSM_PARAMETER_PREFIX ?? '/billing/dev';
  const tenantId = requireLocalSecret('INVENTORI_SANDBOX_TENANT_ID');
  const companyId = requireLocalSecret('INVENTORI_SANDBOX_COMPANY_ID');
  const hacienda = requireHaciendaSandboxCredentials();
  const certificatePath = requireLocalSecret('F4S_SANDBOX_CERT_PATH');
  const certificatePin = requireLocalSecret('F4S_SANDBOX_CERT_PIN');

  if (!existsSync(certificatePath)) {
    throw new Error('Configured local fiscal certificate file is missing.');
  }

  const certificateBytes = readFileSync(certificatePath);
  const fingerprint = createHash('sha256').update(certificateBytes).digest('hex');
  const expected = buildExpectedReferences(companyId, fingerprint);

  const prisma = new PrismaClient();
  try {
    const [connection, certificate] = await Promise.all([
      prisma.haciendaConnection.findFirst({
        where: { tenantId, companyId, environment: 'SANDBOX' },
        select: { secretReference: true },
      }),
      prisma.fiscalSigningCertificate.findFirst({
        where: { tenantId, companyId, environment: 'SANDBOX', status: 'ACTIVE' },
        select: {
          certificateSecretReference: true,
          passwordSecretReference: true,
          fingerprintSha256: true,
        },
      }),
    ]);

    if (
      !connection ||
      !certificate ||
      connection.secretReference !== expected.connection ||
      certificate.certificateSecretReference !== expected.certificate ||
      certificate.passwordSecretReference !== expected.pin ||
      certificate.fingerprintSha256 !== fingerprint
    ) {
      throw new Error('Local certificate or Hacienda references do not match the existing Billing contract.');
    }

    const client = new SSMClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      endpoint: endpoint.toString(),
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
    const names = [
      parameterName(prefix, expected.connection),
      parameterName(prefix, expected.certificate),
      parameterName(prefix, expected.pin),
    ];

    const before = await client.send(new GetParametersCommand({ Names: names, WithDecryption: false }));
    assessParameterState(names, before);

    const values = [
      JSON.stringify({ username: hacienda.username, password: hacienda.password }),
      JSON.stringify({ pkcs12Base64: certificateBytes.toString('base64') }),
      certificatePin,
    ];

    for (let index = 0; index < names.length; index += 1) {
      await client.send(
        new PutParameterCommand({
          Name: names[index],
          Value: values[index],
          Type: 'SecureString',
          Overwrite: false,
          Description: 'Recovered local Hacienda SANDBOX secret',
        }),
      );
    }

    const after = await client.send(new GetParametersCommand({ Names: names, WithDecryption: false }));
    if ((after.Parameters ?? []).length !== names.length || (after.InvalidParameters ?? []).length !== 0) {
      throw new Error('LocalStack SSM post-restore verification failed.');
    }

    process.stdout.write('[OK] Local Hacienda SANDBOX SSM recovery completed (3 parameters).\n');
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectExecution = process.argv[1]
  ?.replace(/\\/g, '/')
  .endsWith('/scripts/dev-restore-hacienda-sandbox-secrets.mjs');

if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write(`[FAIL] ${error instanceof Error ? error.message : 'local secret recovery failed'}\n`);
    process.exit(1);
  });
}
