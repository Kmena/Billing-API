import * as fs from 'node:fs';
import * as path from 'node:path';

describe('node-forge security boundary (GHSA-86w9-cpqp-85rv)', () => {
  const productionRoot = path.resolve(__dirname, '../../../../');

  it('does not use node-forge RSA signature verification in production code', () => {
    const sourceFiles: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') visit(entryPath);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          sourceFiles.push(entryPath);
        }
      }
    };

    visit(productionRoot);

    const forbiddenPatterns = [
      /forge\.pki\.rsa\b/,
      /forge\.rsa\b/,
      /\.publicKey\.verify\s*\(/,
      /\bpublicKey\.verify\s*\(/,
    ];
    const violations = sourceFiles.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return forbiddenPatterns
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${path.relative(productionRoot, file)}: ${pattern.source}`);
    });

    expect(violations).toEqual([]);
  });
});
