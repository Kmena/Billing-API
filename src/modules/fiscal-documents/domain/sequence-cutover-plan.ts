/** Read-only reconciliation of sequence evidence from every known authority. */
export interface SequenceLedgerEvidence {
  source: string;
  issuerIdentity: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  branchCode: string;
  terminalCode: string;
  documentType: 'INVOICE' | 'TICKET' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  nextValue: bigint;
  consumed: readonly bigint[];
  reserved: readonly bigint[];
}

export interface SequenceCutoverDecision {
  knownNextFloor: bigint;
  authorizedNextValue: bigint | null;
  blockedReasons: readonly string[];
  sources: readonly string[];
}

/** A numeric floor cannot authorize emission until source completeness and collisions are certified. */
export function planSequenceCutover(
  evidence: readonly SequenceLedgerEvidence[],
  controls: { externalSourcesComplete: boolean; collisionResolved: boolean },
): SequenceCutoverDecision {
  if (!evidence.length) throw new Error('SEQUENCE_EVIDENCE_REQUIRED');
  const dimensions = new Set(
    evidence.map((row) =>
      [
        row.issuerIdentity,
        row.environment,
        row.branchCode,
        row.terminalCode,
        row.documentType,
      ].join('|'),
    ),
  );
  if (dimensions.size !== 1) throw new Error('SEQUENCE_DIMENSION_MISMATCH');
  const sources = evidence.map((row) => row.source);
  if (sources.some((source) => !source) || new Set(sources).size !== sources.length)
    throw new Error('SEQUENCE_SOURCE_DUPLICATE_OR_EMPTY');
  const numbers = evidence.flatMap((row) => [
    row.nextValue,
    ...row.consumed.map((value) => value + 1n),
    ...row.reserved.map((value) => value + 1n),
  ]);
  if (numbers.some((number) => number < 1n || number > 10_000_000_000n))
    throw new Error('SEQUENCE_VALUE_OUT_OF_RANGE');
  const knownNextFloor = numbers.reduce(
    (highest, number) => (number > highest ? number : highest),
    1n,
  );
  const blockedReasons = [
    ...(!controls.externalSourcesComplete ? ['EXTERNAL_SOURCES_NOT_CLOSED'] : []),
    ...(!controls.collisionResolved ? ['HISTORICAL_COLLISION_UNRESOLVED'] : []),
  ];
  return {
    knownNextFloor,
    authorizedNextValue: blockedReasons.length ? null : knownNextFloor,
    blockedReasons,
    sources,
  };
}
