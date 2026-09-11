const DURATION_PATTERN = /^(\d+)([smhd])$/;
const DURATION_UNITS_IN_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function addAuthDurationToDate(
  baseDate: Date,
  duration: string,
  fallbackDuration = '7d',
): Date {
  const durationMs = parseAuthDurationToMilliseconds(duration, fallbackDuration);
  return new Date(baseDate.getTime() + durationMs);
}

function parseAuthDurationToMilliseconds(duration: string, fallbackDuration: string): number {
  const parsedDuration = parseDuration(duration);
  if (parsedDuration !== null) {
    return parsedDuration;
  }

  const parsedFallback = parseDuration(fallbackDuration);
  if (parsedFallback !== null) {
    return parsedFallback;
  }

  return 7 * DURATION_UNITS_IN_MS.d;
}

function parseDuration(duration: string): number | null {
  const normalizedDuration = duration.trim().toLowerCase();
  const match = DURATION_PATTERN.exec(normalizedDuration);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }

  return amount * DURATION_UNITS_IN_MS[unit];
}
