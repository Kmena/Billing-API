import {
  findUnsafeTestPatterns,
  scanRepositoryForUnsafeTestPatterns,
} from '../../scripts/test-safety/check-test-safety';

describe('test safety static enforcement', () => {
  const rulesFor = (source: string): string[] =>
    findUnsafeTestPatterns(source, 'test/fixtures/example.spec.ts').map((finding) => finding.rule);

  it('rejects global deleteMany with no arguments', () => {
    const source = 'await prisma.tenant.' + 'deleteMany' + '();';
    expect(rulesFor(source)).toContain('global-delete-many');
  });

  it('rejects global deleteMany with an empty object', () => {
    const source = 'await prisma.tenant.' + 'deleteMany' + '({});';
    expect(rulesFor(source)).toContain('global-delete-many');
  });

  it('rejects unsafe raw Prisma execution', () => {
    const source = 'await prisma.$' + 'executeRawUnsafe' + '(statement);';
    expect(rulesFor(source)).toContain('unsafe-raw-prisma');
  });

  it('rejects destructive raw SQL', () => {
    const source = 'await prisma.$' + 'executeRaw' + 'Unsafe("TRUN' + 'CATE users");';
    expect(rulesFor(source)).toContain('destructive-raw-sql');
  });

  it('rejects unmanaged PrismaClient construction', () => {
    const source = 'const prisma = ' + 'new Prisma' + 'Client();';
    expect(rulesFor(source)).toContain('unmanaged-prisma-client');
  });

  it('accepts tenant-scoped cleanup through an injected guarded client', () => {
    const source =
      'await prisma.fiscalDocument.deleteMany({ where: { tenantId: { in: ownedTenantIds } } });';
    expect(rulesFor(source)).toEqual([]);
  });

  it('finds no unsafe pattern in the current test tree', () => {
    expect(scanRepositoryForUnsafeTestPatterns(process.cwd())).toEqual([]);
  });
});
