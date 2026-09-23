/**
 * F4-S Certificate Loader — TASK-003
 *
 * Validates that a PKCS#12 certificate file can be loaded and that the
 * supplied PIN unlocks the private key — WITHOUT logging any secret value.
 *
 * Uses node-forge (already a project dependency) to attempt PKCS#12 parsing.
 * All errors are translated to sanitized error codes.
 *
 * SECURITY RULES:
 *   - The PIN is NEVER included in any thrown error, log, or return value.
 *   - PKCS#12 bytes are NEVER included in any thrown error or return value.
 *   - Private key material is NEVER returned or logged.
 *   - Only sanitized status codes are returned.
 */

import * as fs from 'fs';
import * as forge from 'node-forge';
import type { PrerequisiteItem } from '../types';

export type CertificateLoadStatus =
  | 'READY'
  | 'MISSING_CERT_PATH'
  | 'CERT_FILE_NOT_FOUND'
  | 'CERT_FILE_UNREADABLE'
  | 'MISSING_PIN'
  | 'CERT_PARSE_FAILED'
  | 'CERT_PIN_INVALID'
  | 'CERT_PRIVATE_KEY_MISSING';

export interface CertificateLoadResult {
  readonly status: CertificateLoadStatus;
  /** Safe fingerprint — never the certificate bytes or PIN. */
  readonly subjectCN?: string;
  readonly serialNumber?: string;
}

/**
 * Loads a PKCS#12 file from `certPath` and verifies the `pin` unlocks
 * the private key. Returns a sanitized result — never the key or PIN.
 *
 * This is the DEFAULT loader used by F4sPrerequisiteValidator.
 * Tests inject a mock via the `certificateLoader` option.
 */
export async function loadAndValidatePkcs12(
  certPath: string | undefined,
  pin: string | undefined,
): Promise<CertificateLoadResult> {
  if (!certPath || !certPath.trim()) {
    return { status: 'MISSING_CERT_PATH' };
  }

  if (!pin || !pin.trim()) {
    return { status: 'MISSING_PIN' };
  }

  // Check file exists
  try {
    await fs.promises.access(certPath, fs.constants.R_OK);
  } catch {
    return { status: 'CERT_FILE_NOT_FOUND' };
  }

  // Read file bytes
  let p12Buffer: Buffer;
  try {
    p12Buffer = await fs.promises.readFile(certPath);
  } catch {
    return { status: 'CERT_FILE_UNREADABLE' };
  }

  // Attempt to parse PKCS#12 with the supplied PIN
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12Buffer.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pin);
  } catch {
    // Distinguish parse failure from wrong PIN:
    // Try with empty PIN to see if the format itself is invalid vs wrong PIN.
    try {
      const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12Buffer.toString('binary')));
      forge.pkcs12.pkcs12FromAsn1(p12Asn1, '');
      // If empty PIN works, the cert is valid but PIN is wrong (or cert has no PIN)
      return { status: 'CERT_PIN_INVALID' };
    } catch {
      // Neither the supplied PIN nor empty PIN works — treat as parse failure
      // (could also be wrong PIN, but we cannot distinguish without leaking info)
      return { status: 'CERT_PARSE_FAILED' };
    }
  }

  // Verify private key is present
  let subjectCN: string | undefined;
  let serialNumber: string | undefined;
  let hasPrivateKey = false;

  try {
    // Get key bags
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBagList = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
    const keyBags2 = p12.getBags({ bagType: forge.pki.oids.keyBag });
    const keyBagList2 = keyBags2[forge.pki.oids.keyBag] ?? [];
    hasPrivateKey = keyBagList.length > 0 || keyBagList2.length > 0;

    // Get certificate for safe metadata only
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBagList = certBags[forge.pki.oids.certBag] ?? [];
    if (certBagList.length > 0 && certBagList[0].cert) {
      const cert = certBagList[0].cert;
      const cn = cert.subject.getField('CN');
      subjectCN = cn ? (cn.value as string) : undefined;
      serialNumber = cert.serialNumber;
    }
  } catch {
    // Don't fail if metadata extraction fails — key presence check is what matters
  }

  if (!hasPrivateKey) {
    return { status: 'CERT_PRIVATE_KEY_MISSING', subjectCN, serialNumber };
  }

  return { status: 'READY', subjectCN, serialNumber };
}

/**
 * Converts a CertificateLoadResult into a PrerequisiteItem for the validator report.
 * NEVER includes the PIN or certificate bytes.
 */
export function certificateLoadResultToPrerequisiteItem(
  result: CertificateLoadResult,
  itemName: string,
): PrerequisiteItem {
  switch (result.status) {
    case 'READY':
      return {
        name: itemName,
        status: 'READY',
        sanitizedCode: 'CERTIFICATE_LOADED_PIN_VERIFIED_PRIVATE_KEY_PRESENT',
      };
    case 'MISSING_CERT_PATH':
      return {
        name: itemName,
        status: 'MISSING',
        sanitizedCode: 'SIGNING_CERTIFICATE_PATH_NOT_CONFIGURED',
      };
    case 'CERT_FILE_NOT_FOUND':
      return {
        name: itemName,
        status: 'MISSING',
        sanitizedCode: 'SIGNING_CERTIFICATE_FILE_NOT_FOUND',
      };
    case 'CERT_FILE_UNREADABLE':
      return {
        name: itemName,
        status: 'INVALID',
        sanitizedCode: 'SIGNING_CERTIFICATE_UNREADABLE',
      };
    case 'MISSING_PIN':
      return {
        name: itemName,
        status: 'MISSING',
        sanitizedCode: 'SIGNING_CERTIFICATE_PIN_NOT_CONFIGURED',
      };
    case 'CERT_PARSE_FAILED':
      return {
        name: itemName,
        status: 'INVALID',
        sanitizedCode: 'SIGNING_CERTIFICATE_INVALID',
      };
    case 'CERT_PIN_INVALID':
      return {
        name: itemName,
        status: 'INVALID',
        sanitizedCode: 'SIGNING_CERTIFICATE_PIN_INVALID',
      };
    case 'CERT_PRIVATE_KEY_MISSING':
      return {
        name: itemName,
        status: 'INVALID',
        sanitizedCode: 'SIGNING_PRIVATE_KEY_MISSING',
      };
  }
}
