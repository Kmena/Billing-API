import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

type MigrationEntry = { name: string; sha256: string };
const root = resolve(__dirname, '../../..');
const migrationsPath = join(root, 'prisma', 'migrations');
const manifestPath = join(root, 'docs', 'operations', 'billing-w0-migration-manifest.json');

describe('versioned Prisma migration provenance', () => {
  it('keeps the complete ordered SQL history byte-identical to the reviewed manifest', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as MigrationEntry[];
    const names = readdirSync(migrationsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(manifest.map((entry) => entry.name)).toEqual(names);
    for (const entry of manifest) {
      const sql = readFileSync(join(migrationsPath, entry.name, 'migration.sql'));
      expect(createHash('sha256').update(sql).digest('hex')).toBe(entry.sha256);
    }
  });
});
