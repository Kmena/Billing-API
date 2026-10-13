import { restoreEncryptedSecretStore } from '../src/infrastructure/secrets/local-secret-store-backup';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm-new-destination')) {
    throw new Error(
      'Explicit --confirm-new-destination is required; active stores are never overwritten.',
    );
  }
  const backupPath = option('--backup');
  const destinationPath = option('--destination');
  const masterKeyPath = option('--master-key');
  if (!backupPath || !destinationPath || !masterKeyPath) {
    throw new Error(
      'Usage: npm run secrets:restore -- --confirm-new-destination --backup <backup> --destination <new-directory> --master-key <key-file>',
    );
  }
  const result = await restoreEncryptedSecretStore({
    backupPath,
    destinationPath,
    masterKeyPath,
    requiredMarker: option('--marker'),
  });
  process.stdout.write(
    `[PASS] Encrypted secret restore verified: files=${result.files}; active=${result.activeSecrets}; deleted=${result.deletedSecrets}; versions=${result.versions}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[FAIL] ${error instanceof Error ? error.message : 'secret restore failed'}\n`,
  );
  process.exitCode = 1;
});
