import { backupEncryptedSecretStore } from '../src/infrastructure/secrets/local-secret-store-backup';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const sourcePath = option('--source');
  const destinationPath = option('--destination');
  if (!sourcePath || !destinationPath) {
    throw new Error(
      'Usage: npm run secrets:backup -- --source <encrypted-store> --destination <new-backup-directory>',
    );
  }
  const result = await backupEncryptedSecretStore({ sourcePath, destinationPath });
  process.stdout.write(
    `[PASS] Encrypted secret backup verified: files=${result.files}; manifestSha256=${result.manifestSha256}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[FAIL] ${error instanceof Error ? error.message : 'secret backup failed'}\n`,
  );
  process.exitCode = 1;
});
