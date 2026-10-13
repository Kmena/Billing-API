import { resolveDeliveryRecipient } from '../delivery-recipient.resolver';

describe('resolveDeliveryRecipient', () => {
  it('resolves canonical correoElectronico', () => {
    expect(resolveDeliveryRecipient({ correoElectronico: ' Canonical@Example.COM ' })).toEqual({
      kind: 'RESOLVED',
      recipient: 'canonical@example.com',
    });
  });

  it('resolves legacy email', () => {
    expect(resolveDeliveryRecipient({ email: 'legacy@example.com' })).toEqual({
      kind: 'RESOLVED',
      recipient: 'legacy@example.com',
    });
  });

  it.each([null, undefined, {}, { email: '' }, { correoElectronico: '   ' }])(
    'reports missing when neither recipient is supplied: %p',
    (snapshot) => {
      expect(resolveDeliveryRecipient(snapshot)).toEqual({
        kind: 'MISSING',
        code: 'FISCAL_DELIVERY_RECIPIENT_MISSING',
      });
    },
  );

  it('uses legacy email when canonical is empty', () => {
    expect(
      resolveDeliveryRecipient({ correoElectronico: ' ', email: 'legacy@example.com' }),
    ).toEqual({
      kind: 'RESOLVED',
      recipient: 'legacy@example.com',
    });
  });

  it('uses canonical email when legacy is empty', () => {
    expect(
      resolveDeliveryRecipient({ correoElectronico: 'canonical@example.com', email: '' }),
    ).toEqual({
      kind: 'RESOLVED',
      recipient: 'canonical@example.com',
    });
  });

  it('accepts both fields when normalized values agree', () => {
    expect(
      resolveDeliveryRecipient({
        correoElectronico: ' Receiver@Example.COM ',
        email: 'receiver@example.com',
      }),
    ).toEqual({ kind: 'RESOLVED', recipient: 'receiver@example.com' });
  });

  it('fails closed for conflicting valid fields', () => {
    expect(
      resolveDeliveryRecipient({
        correoElectronico: 'canonical@example.com',
        email: 'legacy@example.com',
      }),
    ).toEqual({ kind: 'CONFLICT', code: 'FISCAL_DELIVERY_RECIPIENT_CONFLICT' });
  });

  it.each([
    { correoElectronico: 'not-an-email' },
    { email: 'not-an-email' },
    { correoElectronico: 'canonical@example.com', email: 'not-an-email' },
    { correoElectronico: 42 },
    { email: {} },
    [],
  ])('fails closed for malformed or structurally invalid input: %p', (snapshot) => {
    expect(resolveDeliveryRecipient(snapshot)).toEqual({
      kind: 'INVALID',
      code: 'FISCAL_DELIVERY_RECIPIENT_INVALID',
    });
  });
});
