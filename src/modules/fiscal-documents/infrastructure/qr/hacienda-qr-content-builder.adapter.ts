/**
 * HaciendaQrContentBuilderAdapter — Production QR content builder.
 *
 * QR payload = {HACIENDA_QR_URL_BASE}?Clave={clave}
 * URL base: operator-configured via HACIENDA_QR_URL_BASE env var.
 * No default hardcoded. Startup validation: fails fast if not configured in production.
 *
 * BILLING ARCHITECTURAL DECISION (DEC-001, DEC-006):
 * Clave in URL satisfies verified Hacienda requirements:
 * - "Clave must be used" (FE + TE XSD v4.4)
 * - "Permit reading via compatible capture device" (DGT-R-000-2024)
 */
import { Injectable } from '@nestjs/common';
import { QrContentBuilderPort } from '../../application/qr/qr-content-builder.port';
import { InvalidClaveException } from '../../domain/delivery/invalid-clave.exception';

const CLAVE_REGEX = /^\d{50}$/;

@Injectable()
export class HaciendaQrContentBuilderAdapter implements QrContentBuilderPort {
  /**
   * @param qrUrlBase - Production Hacienda CE consultation URL base.
   *   Must be configured via HACIENDA_QR_URL_BASE before production deployment.
   *   No default value; missing configuration causes startup failure.
   */
  constructor(private readonly qrUrlBase: string) {
    if (!qrUrlBase || qrUrlBase.trim().length === 0) {
      throw new Error(
        'HACIENDA_QR_URL_BASE must be configured before production deployment. ' +
          'Set the HACIENDA_QR_URL_BASE environment variable to the current Hacienda CE consultation URL.',
      );
    }
  }

  buildQrContent(clave: string): string {
    if (!CLAVE_REGEX.test(clave)) {
      throw new InvalidClaveException(clave);
    }
    return `${this.qrUrlBase}?Clave=${clave}`;
  }
}
