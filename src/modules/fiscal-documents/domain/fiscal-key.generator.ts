import { randomInt } from 'crypto';
import {
  FISCAL_COUNTRY_CODE,
  FISCAL_DOCUMENT_CODES,
  FISCAL_NORMAL_SITUATION,
  FiscalDocumentType,
} from './fiscal.constants';

export function buildConsecutive(input: {
  branchCode: string;
  terminalCode: string;
  documentType: FiscalDocumentType;
  sequenceValue: bigint;
}): string {
  if (!/^\d{3}$/.test(input.branchCode)) throw new Error('branchCode must be 3 digits.');
  if (!/^\d{5}$/.test(input.terminalCode)) throw new Error('terminalCode must be 5 digits.');
  if (input.sequenceValue < 1n || input.sequenceValue > 9999999999n) {
    throw new Error('sequenceValue is outside Hacienda 10-digit range.');
  }
  return `${input.branchCode}${input.terminalCode}${FISCAL_DOCUMENT_CODES[input.documentType]}${input.sequenceValue.toString().padStart(10, '0')}`;
}

export function generateSecurityCode(): string {
  return randomInt(0, 100000000).toString().padStart(8, '0');
}

export function buildFiscalKey(input: {
  issuedAt: Date;
  issuerIdentificationNumber: string;
  consecutive: string;
  securityCode: string;
  situation?: string;
}): string {
  const normalizedIssuerId = input.issuerIdentificationNumber
    .replace(/\D/g, '')
    .padStart(12, '0')
    .slice(-12);
  const day = input.issuedAt.getDate().toString().padStart(2, '0');
  const month = (input.issuedAt.getMonth() + 1).toString().padStart(2, '0');
  const year = (input.issuedAt.getFullYear() % 100).toString().padStart(2, '0');
  const situation = input.situation ?? FISCAL_NORMAL_SITUATION;

  if (!/^\d{20}$/.test(input.consecutive)) throw new Error('consecutive must be 20 digits.');
  if (!/^\d{8}$/.test(input.securityCode)) throw new Error('securityCode must be 8 digits.');
  if (!/^\d$/.test(situation)) throw new Error('situation must be 1 digit.');

  return `${FISCAL_COUNTRY_CODE}${day}${month}${year}${normalizedIssuerId}${input.consecutive}${situation}${input.securityCode}`;
}
