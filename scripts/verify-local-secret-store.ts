import { EncryptedFileSecretProvider } from '../src/infrastructure/secrets/adapters/encrypted-file-secret-provider.adapter';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const rootPath = option('--store');
  const masterKeyPath = option('--master-key');
  if (!rootPath || !masterKeyPath) {
    throw new Error('Usage: npm run secrets:verify -- --store <store> --master-key <key>');
  }
  const provider = new EncryptedFileSecretProvider({
    rootPath,
    masterKeyPath,
    requiredMarker: option('--marker'),
  });
  await provider.ensureReady();
  const result = await provider.verifyAllSecrets();
  process.stdout.write(
    `[PASS] Encrypted secret store verified: active=${result.active}; deleted=${result.deleted}; versions=${result.versions}; values not printed.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[FAIL] ${error instanceof Error ? error.message : 'secret-store verification failed'}\n`,
  );
  process.exitCode = 1;
});
