import { Injectable } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XsdValidatorPort } from '../../application/fiscal-xml/xsd-validator.port';
import {
  HACIENDA_V44_FACTURA_ELECTRONICA,
  HACIENDA_V44_SCHEMA_VERSION,
  HACIENDA_V44_TIQUETE_ELECTRONICO,
} from '../../domain/fiscal-xml/hacienda-v44-contract';
import {
  FiscalXmlGenerationResult,
  FiscalXmlValidationIssue,
  FiscalXmlValidationResult,
} from '../../domain/fiscal-xml/fiscal-xml.types';

interface Xsd11ValidatorAdapterOptions {
  readonly pythonCommand?: string;
  readonly scriptPath?: string;
  readonly timeoutMs?: number;
}

interface EngineValidationPayload {
  readonly valid?: boolean;
  readonly errors?: Array<{
    readonly code?: string;
    readonly message?: string;
    readonly line?: number | null;
    readonly column?: number | null;
  }>;
}

const MAX_VALIDATOR_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10000;

@Injectable()
export class Xsd11ValidatorAdapter implements XsdValidatorPort {
  private readonly pythonCommand: string;
  private readonly scriptPath: string;
  private readonly timeoutMs: number;

  constructor(options: Xsd11ValidatorAdapterOptions = {}) {
    this.pythonCommand =
      options.pythonCommand ??
      process.env.FISCAL_XSD11_PYTHON ??
      (process.platform === 'win32' ? 'python' : 'python3');
    this.scriptPath = options.scriptPath ?? path.join(__dirname, 'xsd11', 'xmlschema-validator.py');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  validate(generatedXml: FiscalXmlGenerationResult): FiscalXmlValidationResult {
    const blockedInput = this.blockedUnsafeXml(generatedXml.xml);
    if (blockedInput) return this.invalid(blockedInput);

    const schemaAsset =
      generatedXml.documentType === 'INVOICE'
        ? HACIENDA_V44_FACTURA_ELECTRONICA
        : HACIENDA_V44_TIQUETE_ELECTRONICO;
    const schemaPath = this.schemaPath(schemaAsset.xsdFileName);
    const checksumIssue = this.verifySchemaChecksum(schemaPath, schemaAsset.sha256);
    if (checksumIssue) return this.invalid(checksumIssue);

    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-fiscal-xsd11-'));
    const xmlPath = path.join(tempDirectory, `${crypto.randomUUID()}.xml`);
    try {
      fs.writeFileSync(xmlPath, generatedXml.xml, { encoding: 'utf8', mode: 0o600 });
      const payload = this.runValidator(['validate', schemaPath, xmlPath]);
      if (payload.valid)
        return { isValid: true, schemaVersion: generatedXml.schemaVersion, errors: [] };
      return this.invalid(this.normalizeEngineErrors(payload.errors));
    } finally {
      this.safeDelete(xmlPath);
      this.safeDelete(tempDirectory);
    }
  }

  compileSchema(
    documentType: FiscalXmlGenerationResult['documentType'],
  ): FiscalXmlValidationResult {
    const schemaAsset =
      documentType === 'INVOICE'
        ? HACIENDA_V44_FACTURA_ELECTRONICA
        : HACIENDA_V44_TIQUETE_ELECTRONICO;
    const schemaPath = this.schemaPath(schemaAsset.xsdFileName);
    const checksumIssue = this.verifySchemaChecksum(schemaPath, schemaAsset.sha256);
    if (checksumIssue) return this.invalid(checksumIssue);
    const payload = this.runValidator(['compile', schemaPath]);
    if (payload.valid)
      return { isValid: true, schemaVersion: HACIENDA_V44_SCHEMA_VERSION, errors: [] };
    return this.invalid(this.normalizeEngineErrors(payload.errors));
  }

  private runValidator(args: string[]): EngineValidationPayload {
    if (!this.isSafeLocalScriptPath(this.scriptPath)) {
      return {
        valid: false,
        errors: [
          {
            code: 'FISCAL_XML_VALIDATOR_CONFIGURATION_INVALID',
            message: 'XSD validator script path is invalid.',
          },
        ],
      };
    }

    try {
      const output = execFileSync(this.pythonCommand, [this.scriptPath, ...args], {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: this.timeoutMs,
        maxBuffer: MAX_VALIDATOR_OUTPUT_BYTES,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return this.parsePayload(output);
    } catch (error) {
      return this.payloadFromProcessError(error);
    }
  }

  private payloadFromProcessError(error: unknown): EngineValidationPayload {
    const processError = error as {
      stdout?: string;
      stderr?: string;
      signal?: string;
      code?: number;
    };
    if (processError.signal === 'SIGTERM' || processError.code === null) {
      return {
        valid: false,
        errors: [{ code: 'FISCAL_XML_VALIDATOR_TIMEOUT', message: 'XSD validation timed out.' }],
      };
    }

    const stdout = processError.stdout?.toString() ?? '';
    const payload = this.parsePayload(stdout);
    if (payload.errors?.length) return payload;

    return {
      valid: false,
      errors: [
        {
          code: 'FISCAL_XML_VALIDATOR_FAILED',
          message: this.sanitize(processError.stderr?.toString() || 'XSD validation failed.'),
        },
      ],
    };
  }

  private parsePayload(output: string): EngineValidationPayload {
    try {
      const parsed = JSON.parse(output.trim()) as EngineValidationPayload;
      return { valid: parsed.valid === true, errors: parsed.errors ?? [] };
    } catch {
      return {
        valid: false,
        errors: [
          {
            code: 'FISCAL_XML_VALIDATOR_FAILED',
            message: 'XSD validator returned invalid output.',
          },
        ],
      };
    }
  }

  private blockedUnsafeXml(xml: string): FiscalXmlValidationIssue[] | null {
    if (/<!DOCTYPE|<!ENTITY|SYSTEM\s+["']|PUBLIC\s+["']/i.test(xml)) {
      return [{ code: 'FISCAL_XML_XXE_BLOCKED', message: 'Unsafe XML declaration.' }];
    }
    if (/xsi:(?:noNamespaceSchemaLocation|schemaLocation)\s*=\s*["'][^"']*https?:\/\//i.test(xml)) {
      return [
        {
          code: 'FISCAL_XML_REMOTE_SCHEMA_BLOCKED',
          message: 'Remote schema resolution is disabled.',
        },
      ];
    }
    return null;
  }

  private normalizeEngineErrors(
    errors: EngineValidationPayload['errors'],
  ): FiscalXmlValidationIssue[] {
    if (!errors?.length) {
      return [{ code: 'FISCAL_XML_VALIDATION_FAILED', message: 'XML failed schema validation.' }];
    }
    return errors.map((error) => ({
      code: this.safeCode(error.code),
      message: this.sanitize(error.message ?? 'XML failed schema validation.'),
      line: error.line ?? undefined,
      column: error.column ?? undefined,
    }));
  }

  private invalid(errors: FiscalXmlValidationIssue[]): FiscalXmlValidationResult {
    return { isValid: false, schemaVersion: HACIENDA_V44_SCHEMA_VERSION, errors };
  }

  private verifySchemaChecksum(
    schemaPath: string,
    expectedSha256: string,
  ): FiscalXmlValidationIssue[] | null {
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(schemaPath)).digest('hex');
    if (checksum === expectedSha256) return null;
    return [
      {
        code: 'FISCAL_XML_SCHEMA_CHECKSUM_MISMATCH',
        message: 'Pinned XSD checksum does not match the expected contract.',
      },
    ];
  }

  private schemaPath(fileName: string): string {
    const normalized = path.basename(fileName);
    return path.join(process.cwd(), 'resources', 'hacienda', 'v4.4', normalized);
  }

  private safeCode(code: string | undefined): string {
    if (!code || !/^[A-Z0-9_]{3,80}$/.test(code)) return 'FISCAL_XML_VALIDATION_FAILED';
    return code;
  }

  private sanitize(message: string): string {
    return message
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/<[^>]+>/g, '<xml omitted>')
      .replace(/[A-Za-z]:\\[^\s]+/g, '<path omitted>')
      .replace(/\/[^\s]+/g, '<path omitted>')
      .slice(0, 300);
  }

  private isSafeLocalScriptPath(scriptPath: string): boolean {
    const resolved = path.resolve(scriptPath);
    return resolved.endsWith(`xmlschema-validator.py`) && fs.existsSync(resolved);
  }

  private safeDelete(targetPath: string): void {
    try {
      const stats = fs.statSync(targetPath);
      if (stats.isDirectory()) fs.rmdirSync(targetPath);
      else fs.unlinkSync(targetPath);
    } catch {
      // Best-effort cleanup only; validation result must not be hidden by cleanup failure.
    }
  }
}
