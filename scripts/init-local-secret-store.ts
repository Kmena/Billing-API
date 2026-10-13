import { initializeEncryptedFileSecretStore } from '../src/infrastructure/secrets/adapters/encrypted-file-secret-provider.adapter';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm-new-store')) {
    throw new Error(
      'Explicit --confirm-new-store is required. This command never rotates an existing key.',
    );
  }
  const rootPath = option('--store');
  const masterKeyPath = option('--master-key');
  if (!rootPath || !masterKeyPath) {
    throw new Error(
      'Usage: npm run secrets:init -- --confirm-new-store --store <new-directory> --master-key <new-key-file>',
    );
  }
  await initializeEncryptedFileSecretStore({
    rootPath,
    masterKeyPath,
    requiredMarker: option('--marker'),
  });
  process.stdout.write(
    '[PASS] New encrypted local secret store initialized; key value not printed.\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[FAIL] ${error instanceof Error ? error.message : 'secret-store initialization failed'}\n`,
  );
  process.exitCode = 1;
});
