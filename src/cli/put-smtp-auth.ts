import { timingSafeEqual } from 'crypto';
import {
  EncryptedFileSecretProvider,
  LocalSecretStoreError,
} from '../infrastructure/secrets/adapters/encrypted-file-secret-provider.adapter';

function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('Interactive TTY required.');
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let input = '';
    const finish = (error?: Error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(input);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Input cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') input = input.slice(0, -1);
        else if (character >= ' ' && character !== '\u007f') input += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm-create-or-identical')) {
    throw new Error('Explicit create-or-identical confirmation required.');
  }
  const store = process.env.LOCAL_SECRET_STORE_PATH;
  const masterKey = process.env.LOCAL_SECRET_STORE_MASTER_KEY_PATH;
  if (!store || !masterKey || process.env.SECRET_PROVIDER !== 'local-encrypted') {
    throw new Error('Durable encrypted local secret store required.');
  }
  const provider = new EncryptedFileSecretProvider({
    rootPath: store,
    masterKeyPath: masterKey,
    requiredMarker: process.env.LOCAL_SECRET_STORE_REQUIRED_MARKER,
  });
  await provider.ensureReady();

  const user = (await readHidden('SMTP account (hidden): ')).trim().toLowerCase();
  const password = (await readHidden('Gmail app password (hidden): ')).replace(/\s/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || password.length < 12) {
    throw new Error('SMTP account or app password has invalid format.');
  }
  const value = JSON.stringify({ user, password });
  try {
    const existing = await provider.getSecret('SMTP_AUTH');
    const left = Buffer.from(existing);
    const right = Buffer.from(value);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new Error('SMTP_AUTH already exists with different credentials; overwrite refused.');
    }
    process.stdout.write('SMTP_AUTH_EXISTS_IDENTICAL\n');
    return;
  } catch (error) {
    if (!(error instanceof LocalSecretStoreError) || error.code !== 'SECRET_NOT_FOUND') throw error;
  }
  await provider.storeSecret('SMTP_AUTH', value);
  const persisted = Buffer.from(await provider.getSecret('SMTP_AUTH'));
  const expected = Buffer.from(value);
  if (persisted.length !== expected.length || !timingSafeEqual(persisted, expected)) {
    throw new Error('Encrypted SMTP credential verification failed.');
  }
  process.stdout.write('SMTP_AUTH_ENCRYPTED_AND_VERIFIED\n');
}

main().catch(() => {
  process.stderr.write('SMTP_AUTH_PROVISIONING_FAILED\n');
  process.exitCode = 1;
});
