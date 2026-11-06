import { planSequenceCutover, SequenceLedgerEvidence } from '../sequence-cutover-plan';

const dimension = {
  issuerIdentity: 'SYNTHETIC-ISSUER',
  environment: 'SANDBOX' as const,
  branchCode: '001',
  terminalCode: '00001',
  documentType: 'INVOICE' as const,
};
const historical: SequenceLedgerEvidence = {
  ...dimension,
  source: 'historical',
  nextValue: 8n,
  consumed: [1n, 2n, 3n, 4n, 5n, 6n, 7n],
  reserved: [],
};
const current: SequenceLedgerEvidence = {
  ...dimension,
  source: 'spec09',
  nextValue: 2n,
  consumed: [1n],
  reserved: [],
};

describe('read-only fiscal sequence cutover', () => {
  it('reports the observed floor but blocks it while sources and the collision remain unresolved', () => {
    expect(
      planSequenceCutover([historical, current], {
        externalSourcesComplete: false,
        collisionResolved: false,
      }),
    ).toEqual({
      knownNextFloor: 8n,
      authorizedNextValue: null,
      blockedReasons: ['EXTERNAL_SOURCES_NOT_CLOSED', 'HISTORICAL_COLLISION_UNRESOLVED'],
      sources: ['historical', 'spec09'],
    });
  });

  it('includes reservations and only authorizes a number after both controls are certified', () => {
    const external: SequenceLedgerEvidence = {
      ...dimension,
      source: 'external-certified',
      nextValue: 9n,
      consumed: [],
      reserved: [11n],
    };
    expect(
      planSequenceCutover([historical, current, external], {
        externalSourcesComplete: true,
        collisionResolved: true,
      }).authorizedNextValue,
    ).toBe(12n);
  });

  it('rejects mixed dimensions, duplicate sources and invalid values', () => {
    expect(() =>
      planSequenceCutover([historical, { ...current, documentType: 'CREDIT_NOTE' }], {
        externalSourcesComplete: true,
        collisionResolved: true,
      }),
    ).toThrow('SEQUENCE_DIMENSION_MISMATCH');
    expect(() =>
      planSequenceCutover([historical, { ...current, source: 'historical' }], {
        externalSourcesComplete: true,
        collisionResolved: true,
      }),
    ).toThrow('SEQUENCE_SOURCE_DUPLICATE_OR_EMPTY');
    expect(() =>
      planSequenceCutover([{ ...current, nextValue: 0n }], {
        externalSourcesComplete: true,
        collisionResolved: true,
      }),
    ).toThrow('SEQUENCE_VALUE_OUT_OF_RANGE');
  });
});
