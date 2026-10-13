export const CURRENT_FISCAL_PDF_TEMPLATE_ID = 'BILLING_DEFAULT_V1';
export const CURRENT_FISCAL_PDF_RENDERER_VERSION = '2.0.0';
export const HISTORICAL_MOCK_PDF_TEMPLATE_ID = 'BILLING_DEFAULT_V1';
export const HISTORICAL_MOCK_PDF_RENDERER_VERSION = '1.0.0';
export const HISTORICAL_MOCK_PDF_MARKER = 'MOCK-BILLING';

export type FiscalPdfVersionClassification =
  'VALID_REAL_CURRENT' | 'VALID_REAL_OLDER_VERSION' | 'HISTORICAL_MOCK' | 'WRONG_VERSION';

export interface FiscalPdfVersionEvidence {
  readonly templateId: string | null;
  readonly rendererVersion: string | null;
  readonly structurallyValid: boolean;
  readonly containsMockMarker: boolean;
}

export function classifyFiscalPdfVersion(
  evidence: FiscalPdfVersionEvidence,
): FiscalPdfVersionClassification {
  if (
    evidence.templateId === HISTORICAL_MOCK_PDF_TEMPLATE_ID &&
    evidence.rendererVersion === HISTORICAL_MOCK_PDF_RENDERER_VERSION &&
    evidence.containsMockMarker
  ) {
    return 'HISTORICAL_MOCK';
  }

  if (
    evidence.templateId === CURRENT_FISCAL_PDF_TEMPLATE_ID &&
    evidence.rendererVersion === CURRENT_FISCAL_PDF_RENDERER_VERSION &&
    evidence.structurallyValid &&
    !evidence.containsMockMarker
  ) {
    return 'VALID_REAL_CURRENT';
  }

  if (
    evidence.templateId === CURRENT_FISCAL_PDF_TEMPLATE_ID &&
    isApprovedOlderRealVersion(evidence.rendererVersion) &&
    evidence.structurallyValid &&
    !evidence.containsMockMarker
  ) {
    return 'VALID_REAL_OLDER_VERSION';
  }

  return 'WRONG_VERSION';
}

function isApprovedOlderRealVersion(rendererVersion: string | null): boolean {
  if (!rendererVersion || !/^\d+\.\d+\.\d+$/.test(rendererVersion)) return false;
  const [major, minor, patch] = rendererVersion.split('.').map((value) => Number(value));
  const [currentMajor, currentMinor, currentPatch] = CURRENT_FISCAL_PDF_RENDERER_VERSION.split(
    '.',
  ).map((value) => Number(value));
  if (major !== currentMajor) return major < currentMajor;
  if (minor !== currentMinor) return minor < currentMinor;
  return patch < currentPatch;
}
