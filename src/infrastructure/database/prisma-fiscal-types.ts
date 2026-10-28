import type { FiscalDocument, Prisma } from '@prisma/client';
export type { FiscalCancellationWorkflow, Prisma } from '@prisma/client';

/** Prisma shapes stay at the infrastructure boundary for fiscal application services. */
export type PrismaTransactionClient = Prisma.TransactionClient;
export type FiscalDocumentSnapshot = FiscalDocument;
export type FiscalDocumentWithXmlArtifacts = Prisma.FiscalDocumentGetPayload<{
  include: { xmlArtifacts: true };
}>;
