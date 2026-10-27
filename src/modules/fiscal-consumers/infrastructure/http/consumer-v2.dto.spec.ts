import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateConsumerAssociationV2Dto,
  CreateConsumerKeyV2Dto,
  LookupConsumerOperationV2Dto,
} from './consumer-v2.dto';

const errors = (type: new () => object, payload: object) =>
  validateSync(plainToInstance(type, payload), { whitelist: true, forbidNonWhitelisted: true });

describe('W1-D1 unregistered v2 DTOs', () => {
  it('requires explicit company, environment, association profile and bounded keys', () => {
    const association = {
      provider: 'AFFILIATIONS',
      externalConsumerKey: 'client-1',
      externalCompanyKey: 'issuer-1',
      companyId: '11111111-1111-4111-8111-111111111111',
      environment: 'SANDBOX',
      profileVersion: 'fiscal-consumer-v2',
    };
    expect(errors(CreateConsumerAssociationV2Dto, association)).toHaveLength(0);
    expect(
      errors(CreateConsumerAssociationV2Dto, { ...association, environment: 'LIVE' }),
    ).not.toHaveLength(0);
    expect(
      errors(CreateConsumerAssociationV2Dto, {
        ...association,
        profileVersion: 'inventori-fiscal-v1',
      }),
    ).not.toHaveLength(0);
    expect(
      errors(CreateConsumerAssociationV2Dto, { ...association, companyId: 'not-a-uuid' }),
    ).not.toHaveLength(0);
    expect(
      errors(CreateConsumerAssociationV2Dto, { ...association, unknown: 'blocked' }),
    ).not.toHaveLength(0);
  });

  it('rejects legacy, duplicate or empty scopes and invalid expiry', () => {
    const key = {
      associationId: '11111111-1111-4111-8111-111111111111',
      scopes: ['fiscal-v2:readiness:read'],
      expiresAt: '2027-01-01T00:00:00.000Z',
    };
    expect(errors(CreateConsumerKeyV2Dto, key)).toHaveLength(0);
    for (const scopes of [[], ['invoices:write'], [key.scopes[0], key.scopes[0]]]) {
      expect(errors(CreateConsumerKeyV2Dto, { ...key, scopes })).not.toHaveLength(0);
    }
    expect(errors(CreateConsumerKeyV2Dto, { ...key, expiresAt: 'tomorrow' })).not.toHaveLength(0);
  });

  it('requires a versioned 256-bit lookup hash', () => {
    const lookup = {
      operation: 'CREATE_INVOICE',
      idempotencyKey: 'invoice-1',
      requestHashVersion: 'sha256-canonical-v1',
      requestHash: 'a'.repeat(64),
    };
    expect(errors(LookupConsumerOperationV2Dto, lookup)).toHaveLength(0);
    for (const change of [
      { requestHash: undefined },
      { requestHash: 'a'.repeat(63) },
      { requestHashVersion: undefined },
      { requestHashVersion: '' },
      { operation: 'CREATE_CREDIT_NOTE' },
      { idempotencyKey: '   ' },
    ]) {
      expect(errors(LookupConsumerOperationV2Dto, { ...lookup, ...change })).not.toHaveLength(0);
    }
  });
});
