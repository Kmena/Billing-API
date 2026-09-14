import { parseAuthDurationToSeconds } from '../auth-token-duration';

describe('parseAuthDurationToSeconds', () => {
  it('returns 900 seconds for 15m', () => {
    expect(parseAuthDurationToSeconds('15m')).toBe(900);
  });

  it('returns 1800 seconds for 30m', () => {
    expect(parseAuthDurationToSeconds('30m')).toBe(1800);
  });

  it('returns 3600 seconds for 1h', () => {
    expect(parseAuthDurationToSeconds('1h')).toBe(3600);
  });

  it('returns 86400 seconds for 1d', () => {
    expect(parseAuthDurationToSeconds('1d')).toBe(86400);
  });

  it('returns 30 seconds for 30s', () => {
    expect(parseAuthDurationToSeconds('30s')).toBe(30);
  });

  it('falls back to 15m when the duration is invalid', () => {
    expect(parseAuthDurationToSeconds('invalid')).toBe(900);
  });

  it('uses the custom fallback when the duration is invalid', () => {
    expect(parseAuthDurationToSeconds('invalid', '1h')).toBe(3600);
  });

  it('falls back to 900 seconds when the duration and custom fallback are invalid', () => {
    expect(parseAuthDurationToSeconds('invalid', 'also-invalid')).toBe(900);
  });
});
