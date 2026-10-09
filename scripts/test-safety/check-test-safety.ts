import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

export interface UnsafeTestPattern {
  readonly file: string;
  readonly rule: string;
  readonly line: number;
}

const DIRECT_PRISMA_ALLOWLIST = new Set(['test/helpers/guarded-test-prisma.ts']);
const STATIC_FIXTURE_ALLOWLIST = new Set(['test/safety/test-safety-static.spec.ts']);

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

function normalizedPath(path: string): string {
  return path.split(sep).join('/');
}

function collectTypeScriptFiles(root: string): string[] {
  if (!statSync(root).isDirectory()) return [root];
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectTypeScriptFiles(path));
    } else if (path.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

export function findUnsafeTestPatterns(
  source: string,
  repositoryPath: string,
): UnsafeTestPattern[] {
  const file = normalizedPath(repositoryPath);
  if (STATIC_FIXTURE_ALLOWLIST.has(file)) return [];

  const findings: UnsafeTestPattern[] = [];
  const rules: Array<{ readonly rule: string; readonly pattern: RegExp }> = [
    {
      rule: 'global-delete-many',
      pattern: /\.deleteMany\s*\(\s*(?:\{\s*\})?\s*\)/g,
    },
    {
      rule: 'unsafe-raw-prisma',
      pattern: /\$(?:executeRawUnsafe|queryRawUnsafe)\s*\(/g,
    },
    {
      rule: 'destructive-raw-sql',
      pattern:
        /\$(?:executeRaw|queryRaw)(?:Unsafe)?[\s\S]{0,240}\b(?:TRUNCATE|DROP\s+(?:TABLE|DATABASE|SCHEMA))\b/gi,
    },
  ];

  if (!DIRECT_PRISMA_ALLOWLIST.has(file)) {
    rules.push({
      rule: 'unmanaged-prisma-client',
      pattern: /new\s+PrismaClient\s*\(/g,
    });
  }

  for (const { rule, pattern } of rules) {
    for (const match of source.matchAll(pattern)) {
      findings.push({
        file,
        rule,
        line: lineNumber(source, match.index ?? 0),
      });
    }
  }
  return findings;
}

export function scanRepositoryForUnsafeTestPatterns(repositoryRoot: string): UnsafeTestPattern[] {
  const roots = [join(repositoryRoot, 'test'), join(repositoryRoot, 'src')];
  const files = roots.flatMap((root) => collectTypeScriptFiles(root));
  const findings: UnsafeTestPattern[] = [];

  for (const path of files) {
    const repositoryPath = normalizedPath(relative(repositoryRoot, path));
    const isTestSource =
      repositoryPath.startsWith('test/') ||
      repositoryPath.includes('/__tests__/') ||
      repositoryPath.endsWith('.spec.ts');
    if (!isTestSource) continue;
    findings.push(...findUnsafeTestPatterns(readFileSync(path, 'utf8'), repositoryPath));
  }

  return findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.rule.localeCompare(right.rule),
  );
}

if (require.main === module) {
  const findings = scanRepositoryForUnsafeTestPatterns(process.cwd());
  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(
        finding.file + ':' + finding.line + ' [' + finding.rule + '] unsafe test pattern\n',
      );
    }
    process.exitCode = 1;
  } else {
    process.stdout.write('TEST_SAFETY_STATIC_CHECK=PASS\n');
  }
}
