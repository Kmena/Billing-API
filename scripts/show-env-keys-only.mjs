/**
 * Shows only VARIABLE NAMES and metadata from .env.local — NEVER prints values of secrets.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const content = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const lines = content.split('\n');

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    process.stdout.write(line + '\n');
    continue;
  }
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx < 0) { process.stdout.write(line + '\n'); continue; }
  const varName = trimmed.slice(0, eqIdx).trim();
  const varVal = trimmed.slice(eqIdx + 1).trim();

  const isSensitive = /key|secret|password|token|jwt|pass|pin|cert|p12/i.test(varName);
  if (isSensitive && varVal.length > 0) {
    process.stdout.write(`${varName}=[SET, length=${varVal.length}]\n`);
  } else {
    process.stdout.write(`${varName}=${varVal}\n`);
  }
}
