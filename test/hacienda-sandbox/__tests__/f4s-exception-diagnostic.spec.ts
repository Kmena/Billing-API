/**
 * Unit tests for f4s-exception-diagnostic helpers.
 *
 * Validates requirements from TASK-009 diagnostic improvement:
 *   1. BadRequestException { code } preserves the domain code.
 *   2. HTTP status 400 is preserved.
 *   3. Generic Error is safely represented (returns null).
 *   4. Arbitrary getResponse() fields are NOT included in output.
 *   5. Secret-looking values in getResponse() are rejected by domain code validator.
 *   6. XML content in getResponse() is NOT returned.
 *   7. PipelineStage values are valid explicit identifiers.
 *   8. Zero Hacienda HTTP requests occur (all tests are pure unit tests).
 *
 * All tests are pure — zero network, zero DB, zero NestJS bootstrap.
 */

import {
  extractHttpExceptionDiagnostic,
  isHttpExceptionShape,
  sanitizeXsdMessage,
  validateDomainCode,
  type PipelineStage,
} from '../diagnostics/f4s-exception-diagnostic';

// ── Fake HttpException factory ────────────────────────────────────────────────
// Uses duck-typing, same as the extractor. No @nestjs/common import needed.

function fakeHttpException(status: number, response: unknown, name = 'BadRequestException') {
  return {
    getStatus: () => status,
    getResponse: () => response,
    constructor: { name },
    message: 'Bad Request Exception', // NestJS default .message — NOT the domain code
    name,
  };
}

// ── isHttpExceptionShape ──────────────────────────────────────────────────────

describe('isHttpExceptionShape', () => {
  it('returns true for an object with getStatus and getResponse methods', () => {
    expect(isHttpExceptionShape(fakeHttpException(400, { code: 'TEST' }))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isHttpExceptionShape(new Error('some error'))).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isHttpExceptionShape('Bad Request Exception')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isHttpExceptionShape(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isHttpExceptionShape(undefined)).toBe(false);
  });

  it('returns false for a plain object without methods', () => {
    expect(isHttpExceptionShape({ code: 'SOME_CODE', status: 400 })).toBe(false);
  });
});

// ── validateDomainCode ────────────────────────────────────────────────────────

describe('validateDomainCode', () => {
  it('accepts valid domain codes (all-caps, underscores, digits)', () => {
    expect(validateDomainCode('COMPANY_FISCAL_PROFILE_INCOMPLETE')).toBe(
      'COMPANY_FISCAL_PROFILE_INCOMPLETE',
    );
    expect(validateDomainCode('FISCAL_ISSUANCE_POINT_REQUIRED')).toBe(
      'FISCAL_ISSUANCE_POINT_REQUIRED',
    );
    expect(validateDomainCode('HACIENDA_CONNECTION_REQUIRED')).toBe('HACIENDA_CONNECTION_REQUIRED');
    expect(validateDomainCode('API_KEY_COMPANY_NOT_AUTHORIZED')).toBe(
      'API_KEY_COMPANY_NOT_AUTHORIZED',
    );
  });

  it('rejects lowercase strings (could be user data or secrets)', () => {
    expect(validateDomainCode('some_code')).toBeNull();
    expect(validateDomainCode('bad request')).toBeNull();
  });

  it('rejects strings with special characters (URL, base64, JSON)', () => {
    expect(validateDomainCode('https://example.com/path')).toBeNull();
    expect(validateDomainCode('eyJhbGciOiJSUzI1Ni')).toBeNull(); // base64 fragment
    expect(validateDomainCode('{"code":"leaked"}')).toBeNull();
  });

  it('rejects strings that look like secrets (mixed case, spaces)', () => {
    expect(validateDomainCode('mySecretPassword123')).toBeNull();
    expect(validateDomainCode('Bearer token123')).toBeNull();
  });

  it('rejects strings over 100 characters', () => {
    expect(validateDomainCode('A'.repeat(101))).toBeNull();
    expect(validateDomainCode('A'.repeat(100))).toBe('A'.repeat(100)); // exactly 100 is fine
  });

  it('rejects non-string values', () => {
    expect(validateDomainCode(42)).toBeNull();
    expect(validateDomainCode(null)).toBeNull();
    expect(validateDomainCode(undefined)).toBeNull();
    expect(validateDomainCode({ code: 'VALID' })).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateDomainCode('')).toBeNull();
  });
});

// ── extractHttpExceptionDiagnostic ────────────────────────────────────────────

describe('extractHttpExceptionDiagnostic', () => {
  // Requirement 1: domain code is preserved
  describe('requirement 1 — domain code is preserved from BadRequestException', () => {
    it('extracts domain code from response.code', () => {
      const err = fakeHttpException(400, { code: 'COMPANY_FISCAL_PROFILE_INCOMPLETE' });
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.domainCode).toBe('COMPANY_FISCAL_PROFILE_INCOMPLETE');
    });

    it('extracts domain code from NotFoundException', () => {
      const err = fakeHttpException(
        404,
        { code: 'FISCAL_DOCUMENT_NOT_FOUND' },
        'NotFoundException',
      );
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.domainCode).toBe('FISCAL_DOCUMENT_NOT_FOUND');
    });

    it('extracts domain code from ConflictException', () => {
      const err = fakeHttpException(
        409,
        { code: 'FISCAL_SEQUENCE_EXHAUSTED' },
        'ConflictException',
      );
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.domainCode).toBe('FISCAL_SEQUENCE_EXHAUSTED');
    });

    it('returns null domainCode when response has no code field', () => {
      const err = fakeHttpException(400, {
        statusCode: 400,
        message: 'Bad Request',
        error: 'Bad Request',
      });
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.domainCode).toBeNull();
    });

    it('returns null domainCode when response is a plain string', () => {
      const err = fakeHttpException(400, 'Bad Request');
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.domainCode).toBeNull();
    });
  });

  // Requirement 2: HTTP status is preserved
  describe('requirement 2 — HTTP status is preserved', () => {
    it('preserves HTTP status 400', () => {
      const err = fakeHttpException(400, { code: 'SOME_CODE' });
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.httpStatus).toBe(400);
    });

    it('preserves HTTP status 404', () => {
      const err = fakeHttpException(404, { code: 'NOT_FOUND' }, 'NotFoundException');
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.httpStatus).toBe(404);
    });

    it('preserves HTTP status 409', () => {
      const err = fakeHttpException(409, { code: 'CONFLICT' }, 'ConflictException');
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.httpStatus).toBe(409);
    });

    it('includes exceptionType matching the class name', () => {
      const err = fakeHttpException(400, { code: 'TEST' }, 'BadRequestException');
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.exceptionType).toBe('BadRequestException');
    });
  });

  // Requirement 3: generic Error returns null
  describe('requirement 3 — generic Error is safely represented (returns null)', () => {
    it('returns null for plain Error', () => {
      expect(extractHttpExceptionDiagnostic(new Error('something failed'))).toBeNull();
    });

    it('returns null for a string', () => {
      expect(extractHttpExceptionDiagnostic('Bad Request Exception')).toBeNull();
    });

    it('returns null for null', () => {
      expect(extractHttpExceptionDiagnostic(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(extractHttpExceptionDiagnostic(undefined)).toBeNull();
    });

    it('returns null for a number', () => {
      expect(extractHttpExceptionDiagnostic(400)).toBeNull();
    });
  });

  // Requirement 4: arbitrary getResponse() fields are NOT included
  describe('requirement 4 — arbitrary getResponse() fields are NOT dumped', () => {
    it('does not include message field from getResponse()', () => {
      const err = fakeHttpException(400, {
        code: 'TEST_CODE',
        message: 'some message that should not appear',
        error: 'Bad Request',
        statusCode: 400,
      });
      const result = extractHttpExceptionDiagnostic(err);
      // The result type only has: exceptionType, httpStatus, domainCode
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain('some message that should not appear');
      expect(resultStr).not.toContain('"error"');
      expect(resultStr).not.toContain('"statusCode"');
    });

    it('does not include errors array from XSD validation failure', () => {
      const err = fakeHttpException(400, {
        code: 'FISCAL_XML_VALIDATION_FAILED',
        errors: [{ code: 'XSD_001', message: '<FacturaElectronica>...</FacturaElectronica>' }],
      });
      const result = extractHttpExceptionDiagnostic(err);
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain('FacturaElectronica');
      expect(resultStr).not.toContain('"errors"');
    });

    it('output only contains exactly: exceptionType, httpStatus, domainCode', () => {
      const err = fakeHttpException(400, { code: 'SOME_CODE', extra: 'SHOULD_NOT_APPEAR' });
      const result = extractHttpExceptionDiagnostic(err);
      expect(result).not.toBeNull();
      // Only these three keys should exist
      const keys = Object.keys(result!);
      expect(keys).toEqual(expect.arrayContaining(['exceptionType', 'httpStatus', 'domainCode']));
      expect(keys).toHaveLength(3);
    });
  });

  // Requirement 5: secret-looking values are not included
  describe('requirement 5 — secret-looking values are rejected', () => {
    it('rejects a "code" value that looks like a password', () => {
      const err = fakeHttpException(400, { code: 'mySecretPassword123!' });
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.domainCode).toBeNull(); // fails domain code validation
    });

    it('rejects a "code" value that looks like a JWT or token', () => {
      const err = fakeHttpException(400, { code: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9' });
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.domainCode).toBeNull();
    });

    it('rejects a "code" value containing a DATABASE_URL', () => {
      const err = fakeHttpException(400, {
        code: 'postgresql://billing:secret@localhost:5432/billing_dev',
      });
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.domainCode).toBeNull();
    });

    it('rejects a "code" value that is a base64 blob (certificate material)', () => {
      const base64Cert = 'MIIEpDCCAowCAQAwgZ8xCzAJBgNVBAYTAkNSMQ8wDQYDVQQ';
      const err = fakeHttpException(400, { code: base64Cert });
      const result = extractHttpExceptionDiagnostic(err);
      expect(result?.domainCode).toBeNull();
    });
  });

  // Requirement 6: XML contents are not returned
  describe('requirement 6 — XML contents are not returned', () => {
    it('does not return XML from a plain string response', () => {
      const err = fakeHttpException(400, '<FacturaElectronica>...</FacturaElectronica>');
      const result = extractHttpExceptionDiagnostic(err);
      // Plain string responses: domainCode is null, and the string is never included
      expect(result?.domainCode).toBeNull();
      expect(JSON.stringify(result)).not.toContain('FacturaElectronica');
    });

    it('does not return XML from errors array in getResponse()', () => {
      const err = fakeHttpException(400, {
        code: 'FISCAL_XML_VALIDATION_FAILED',
        errors: [{ line: 5, message: '<FacturaElectronica attr="x"/>' }],
      });
      const result = extractHttpExceptionDiagnostic(err);
      expect(JSON.stringify(result)).not.toContain('FacturaElectronica');
    });

    it('does not include raw XML that might be in a non-standard code field', () => {
      const err = fakeHttpException(400, {
        code: '<invalid>xml-in-code-field</invalid>',
      });
      const result = extractHttpExceptionDiagnostic(err);
      // XML-like string fails domain code validation → null
      expect(result?.domainCode).toBeNull();
      expect(JSON.stringify(result)).not.toContain('<invalid>');
    });
  });
});

// ── sanitizeXsdMessage ───────────────────────────────────────────────────────

describe('sanitizeXsdMessage', () => {
  it('strips XML element tags', () => {
    expect(sanitizeXsdMessage('<FacturaElectronica>data</FacturaElectronica>')).not.toContain('<');
    expect(sanitizeXsdMessage('<FacturaElectronica>data</FacturaElectronica>')).toContain('[xml]');
  });

  it('strips attribute content inside tags', () => {
    const result = sanitizeXsdMessage('<Nombre attr="sensitive">value</Nombre>');
    expect(result).not.toContain('sensitive');
    expect(result).not.toContain('Nombre');
  });

  it('preserves plain validation error messages', () => {
    const msg = 'value length cannot be lesser than 5';
    expect(sanitizeXsdMessage(msg)).toBe(msg);
  });

  it('preserves XSD type error messages', () => {
    const msg = "value 'X' is not valid under restriction";
    expect(sanitizeXsdMessage(msg)).toBe(msg);
  });

  it('strips Windows file paths', () => {
    const msg = 'error at C:\\Users\\keylor\\schema.xsd line 5';
    const result = sanitizeXsdMessage(msg);
    expect(result).not.toContain('keylor');
    expect(result).toContain('[path]');
  });

  it('strips Unix absolute paths', () => {
    const msg = 'error at /home/user/schema.xsd line 5';
    const result = sanitizeXsdMessage(msg);
    expect(result).not.toContain('home');
    expect(result).toContain('[path]');
  });

  it('truncates messages longer than 200 characters', () => {
    const long = 'x'.repeat(250);
    expect(sanitizeXsdMessage(long).length).toBeLessThanOrEqual(200);
  });

  it('handles empty string gracefully', () => {
    expect(sanitizeXsdMessage('')).toBe('');
  });
});

// ── XSD first error capture ───────────────────────────────────────────────────

describe('extractHttpExceptionDiagnostic — XSD first error capture', () => {
  it('captures xsdFirstError for FISCAL_XML_VALIDATION_FAILED with errors[0]', () => {
    const err = fakeHttpException(400, {
      code: 'FISCAL_XML_VALIDATION_FAILED',
      errors: [
        {
          code: 'FISCAL_XML_VALIDATION_FAILED',
          message: 'value length cannot be lesser than 5',
          line: 42,
        },
      ],
    });
    const result = extractHttpExceptionDiagnostic(err);
    expect(result?.xsdFirstError).toBeDefined();
    expect(result?.xsdFirstError?.xsdLine).toBe(42);
    expect(result?.xsdFirstError?.xsdMessage).toBe('value length cannot be lesser than 5');
  });

  it('does NOT add xsdFirstError for non-XSD errors', () => {
    const err = fakeHttpException(400, { code: 'COMPANY_FISCAL_PROFILE_INCOMPLETE' });
    const result = extractHttpExceptionDiagnostic(err);
    expect(result?.xsdFirstError).toBeUndefined();
    // Keys remain: exceptionType, httpStatus, domainCode
    expect(Object.keys(result!)).toHaveLength(3);
  });

  it('sanitizes XML content in xsdFirstError.xsdMessage — tags stripped, text preserved', () => {
    // XML TAGS (element names, attributes) are stripped.
    // TEXT CONTENT between tags is preserved — this is the useful diagnostic value
    // (e.g., the offending field value that failed minLength).
    const err = fakeHttpException(400, {
      code: 'FISCAL_XML_VALIDATION_FAILED',
      errors: [{ message: '<FacturaElectronica>diagnostic-value</FacturaElectronica>', line: 10 }],
    });
    const result = extractHttpExceptionDiagnostic(err);
    // Element names (tags) are stripped
    expect(result?.xsdFirstError?.xsdMessage).not.toContain('FacturaElectronica');
    // [xml] placeholder replaces the tag markup
    expect(result?.xsdFirstError?.xsdMessage).toContain('[xml]');
    // The actual diagnostic value (text content) is preserved for root-cause analysis
    // Note: this is intentional — validators report the offending value in error messages
    expect(result?.xsdFirstError?.xsdMessage).toContain('diagnostic-value');
  });

  it('captures xsdLine=null when no line number is provided', () => {
    const err = fakeHttpException(400, {
      code: 'FISCAL_XML_VALIDATION_FAILED',
      errors: [{ message: 'some xsd error' }],
    });
    const result = extractHttpExceptionDiagnostic(err);
    expect(result?.xsdFirstError?.xsdLine).toBeNull();
  });

  it('skips xsdFirstError when errors array is empty', () => {
    const err = fakeHttpException(400, {
      code: 'FISCAL_XML_VALIDATION_FAILED',
      errors: [],
    });
    const result = extractHttpExceptionDiagnostic(err);
    expect(result?.xsdFirstError).toBeUndefined();
  });

  it('skips xsdFirstError when errors[0].message is not a string', () => {
    const err = fakeHttpException(400, {
      code: 'FISCAL_XML_VALIDATION_FAILED',
      errors: [{ message: 12345, line: 5 }],
    });
    const result = extractHttpExceptionDiagnostic(err);
    expect(result?.xsdFirstError).toBeUndefined();
  });

  it('result with xsdFirstError has 4 keys total', () => {
    const err = fakeHttpException(400, {
      code: 'FISCAL_XML_VALIDATION_FAILED',
      errors: [{ message: 'too short', line: 7 }],
    });
    const result = extractHttpExceptionDiagnostic(err);
    expect(Object.keys(result!)).toHaveLength(4);
    expect(Object.keys(result!)).toContain('xsdFirstError');
  });

  it('real-world XSD minLength error passes sanitization cleanly', () => {
    // This is the actual error format from the xmlschema library when
    // Emisor.Nombre is shorter than 5 characters (the TASK-009 root cause).
    const err = fakeHttpException(400, {
      code: 'FISCAL_XML_VALIDATION_FAILED',
      errors: [{ message: 'value length cannot be lesser than 5', line: undefined }],
    });
    const result = extractHttpExceptionDiagnostic(err);
    expect(result?.xsdFirstError?.xsdMessage).toBe('value length cannot be lesser than 5');
    // Must pass assertNoSecrets pattern check (no secrets in this message)
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('certificate');
    expect(serialized).not.toContain('pkcs12');
  });
});

// ── PipelineStage type safety ─────────────────────────────────────────────────

describe('PipelineStage type', () => {
  // Requirement 7: failure stage is explicit
  const VALID_STAGES: PipelineStage[] = [
    'DOCUMENT_CREATION',
    'XML_PREPARATION',
    'XSD_VALIDATION',
    'SIGNING',
    'ARTIFACT_LOOKUP',
    'SUBMISSION_CREATE',
  ];

  it('exports all expected pipeline stage identifiers', () => {
    // This is a compile-time type check; at runtime we just verify all values exist
    for (const stage of VALID_STAGES) {
      expect(typeof stage).toBe('string');
      expect(stage.length).toBeGreaterThan(0);
      // All stage identifiers match the same pattern as domain codes
      expect(/^[A-Z_]+$/.test(stage)).toBe(true);
    }
  });

  it('DOCUMENT_CREATION and XML_PREPARATION are distinct stage identifiers', () => {
    const docStage: PipelineStage = 'DOCUMENT_CREATION';
    const xmlStage: PipelineStage = 'XML_PREPARATION';
    expect(docStage).not.toBe(xmlStage);
  });
});
