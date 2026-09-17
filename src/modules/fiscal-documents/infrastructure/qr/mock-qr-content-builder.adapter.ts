/**
 * MockQrContentBuilderAdapter — TEST-ONLY / NON-AUTHORITATIVE.
 *
 * Used in CI/test environments only. Must NEVER be used in production.
 * Provides deterministic QR payload for test assertions.
 *
 * Output: https://mock.hacienda.test/qr?Clave={clave}
 *
 * Test vectors (from pdf-rendering-contract.md):
 * - 50-digit clave → https://mock.hacienda.test/qr?Clave={clave}
 * - < 50 digits → InvalidClaveException
 * - > 50 digits → InvalidClaveException
 * - non-digit → InvalidClaveException
 */
import { Injectable } from '@nestjs/common';
import { QrContentBuilderPort } from '../../application/qr/qr-content-builder.port';
import { InvalidClaveException } from '../../domain/delivery/invalid-clave.exception';

// TEST-ONLY — NON-AUTHORITATIVE — must never be used in production
export const MOCK_QR_BASE = 'https://mock.hacienda.test/qr';

const CLAVE_REGEX = /^\d{50}$/;

@Injectable()
export class MockQrContentBuilderAdapter implements QrContentBuilderPort {
  buildQrContent(clave: string): string {
    if (!CLAVE_REGEX.test(clave)) {
      throw new InvalidClaveException(clave);
    }
    return `${MOCK_QR_BASE}?Clave=${clave}`;
  }
}
