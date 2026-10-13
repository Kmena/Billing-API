export const FISCAL_XML_ERROR = {
  documentNotFound: 'FISCAL_DOCUMENT_NOT_FOUND',
  documentNotReady: 'FISCAL_DOCUMENT_NOT_READY_FOR_XML',
  xmlSnapshotIncomplete: 'FISCAL_XML_SNAPSHOT_INCOMPLETE',
  xmlGenerationFailed: 'FISCAL_XML_GENERATION_FAILED',
  xmlValidationFailed: 'FISCAL_XML_VALIDATION_FAILED',
  schemaChecksumMismatch: 'FISCAL_XML_SCHEMA_CHECKSUM_MISMATCH',
  certificateNotConfigured: 'FISCAL_SIGNING_CERTIFICATE_NOT_CONFIGURED',
  certificateDisabled: 'FISCAL_SIGNING_CERTIFICATE_DISABLED',
  certificateExpired: 'FISCAL_SIGNING_CERTIFICATE_EXPIRED',
  certificateScopeMismatch: 'FISCAL_SIGNING_CERTIFICATE_SCOPE_MISMATCH',
  certificateInvalidSecret: 'FISCAL_SIGNING_CERTIFICATE_INVALID_SECRET',
  signingFailed: 'FISCAL_XML_SIGNING_FAILED',
  signatureVerificationFailed: 'FISCAL_XML_SIGNATURE_VERIFICATION_FAILED',
  artifactStorageFailed: 'FISCAL_XML_ARTIFACT_STORAGE_FAILED',
  // F5 certificate identity enforcement (TASK-004, TASK-006)
  certificateEmitterMismatch: 'FISCAL_CERTIFICATE_EMITTER_MISMATCH',
  certificateIdentityUnverified: 'FISCAL_CERTIFICATE_IDENTITY_UNVERIFIED',
  certificateIdentityConflict: 'FISCAL_CERTIFICATE_IDENTITY_CONFLICT',
  // Wave 8 — RFR-TASK-801: receiver economic activity
  // Emitted when receiver.economicActivity is supplied (non-null, non-empty) but does not
  // satisfy the Hacienda v4.4 XSD contract (exactly 6 characters).
  invalidReceiverActivity: 'FISCAL_XML_INVALID_RECEIVER_ACTIVITY',
} as const;
