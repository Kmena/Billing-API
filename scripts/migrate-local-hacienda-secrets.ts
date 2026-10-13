import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import {
  EncryptedFileSecretProvider,
  LocalSecretStoreError,
} from '../src/infrastructure/secrets/adapters/encrypted-file-secret-provider.adapter';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing required option ${name}.`);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required recovery environment variable ${name} is absent or empty.`);
  return value;
}

function digest(value: string | Buffer): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

function sameSecret(left: string, right: string): boolean {
  return crypto.timingSafeEqual(digest(left), digest(right));
}

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm-recovered-values')) {
    throw new Error(
      'Explicit --confirm-recovered-values is required; conflicting values are never overwritten.',
    );
  }
  const rootPath = requiredOption('--store');
  const masterKeyPath = requiredOption('--master-key');
  const certificatePath = requiredOption('--certificate-file');
  const expectedFingerprint = requiredOption('--certificate-sha256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
    throw new Error(
      'The expected certificate SHA-256 must be 64 lowercase hexadecimal characters.',
    );
  }
  const references = [
    requiredOption('--credentials-ref'),
    requiredOption('--certificate-ref'),
    requiredOption('--pin-ref'),
  ];
  if (new Set(references).size !== references.length)
    throw new Error('Secret references must be distinct.');

  const certificate = await fs.readFile(certificatePath);
  if (digest(certificate).toString('hex') !== expectedFingerprint) {
    throw new Error('Recovered certificate does not match the approved database fingerprint.');
  }
  const values = [
    JSON.stringify({
      username: requiredEnv('F4S_SANDBOX_USERNAME'),
      password: requiredEnv('F4S_SANDBOX_PASSWORD'),
    }),
    JSON.stringify({ pkcs12Base64: certificate.toString('base64') }),
    requiredEnv('F4S_SANDBOX_CERT_PIN'),
  ];

  const provider = new EncryptedFileSecretProvider({
    rootPath,
    masterKeyPath,
    requiredMarker: option('--marker'),
  });
  await provider.ensureReady();

  const missing: number[] = [];
  for (let index = 0; index < references.length; index += 1) {
    try {
      const existing = await provider.getSecret(references[index]);
      if (!sameSecret(existing, values[index])) {
        throw new Error(
          'A target reference contains a different value; migration refused before writes.',
        );
      }
    } catch (error: unknown) {
      if (error instanceof LocalSecretStoreError && error.code === 'SECRET_NOT_FOUND') {
        missing.push(index);
      } else {
        throw error;
      }
    }
  }

  for (const index of missing) await provider.storeSecret(references[index], values[index]);
  for (let index = 0; index < references.length; index += 1) {
    if (!sameSecret(await provider.getSecret(references[index]), values[index])) {
      throw new Error('Post-migration secret verification failed.');
    }
  }
  process.stdout.write(
    `[PASS] Hacienda recovery material verified: references=3; newlyCreated=${missing.length}; values not printed.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[FAIL] ${error instanceof Error ? error.message : 'Hacienda secret migration failed'}\n`,
  );
  process.exitCode = 1;
});
