import * as crypto from 'crypto';
import {
  EncryptedFileSecretProvider,
  LocalSecretStoreError,
} from '../src/infrastructure/secrets/adapters/encrypted-file-secret-provider.adapter';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function sameSecret(left: string, right: string): boolean {
  const a = crypto.createHash('sha256').update(left, 'utf8').digest();
  const b = crypto.createHash('sha256').update(right, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm-create-or-identical')) {
    throw new Error(
      'Explicit --confirm-create-or-identical is required; conflicting values are never overwritten.',
    );
  }
  const rootPath = option('--store');
  const masterKeyPath = option('--master-key');
  const reference = option('--reference');
  const valueEnv = option('--value-env');
  if (
    !rootPath ||
    !masterKeyPath ||
    !reference ||
    !valueEnv ||
    !/^[A-Z][A-Z0-9_]*$/.test(valueEnv)
  ) {
    throw new Error(
      'Usage: npm run secrets:put -- --confirm-create-or-identical --store <store> --master-key <key> --reference <reference> --value-env <ENV_NAME>',
    );
  }
  const value = process.env[valueEnv];
  if (!value) throw new Error('The selected value environment variable is absent or empty.');
  const provider = new EncryptedFileSecretProvider({
    rootPath,
    masterKeyPath,
    requiredMarker: option('--marker'),
  });
  await provider.ensureReady();
  try {
    const existing = await provider.getSecret(reference);
    if (!sameSecret(existing, value)) {
      throw new Error('The reference already contains a different value; overwrite refused.');
    }
    process.stdout.write('[PASS] Existing encrypted secret matches; no write performed.\n');
    return;
  } catch (error: unknown) {
    if (!(error instanceof LocalSecretStoreError) || error.code !== 'SECRET_NOT_FOUND') throw error;
  }
  await provider.storeSecret(reference, value);
  if (!sameSecret(await provider.getSecret(reference), value)) {
    throw new Error('Encrypted secret post-write verification failed.');
  }
  process.stdout.write('[PASS] Encrypted secret created and verified; value not printed.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[FAIL] ${error instanceof Error ? error.message : 'secret write failed'}\n`,
  );
  process.exitCode = 1;
});
