import { Injectable } from '@nestjs/common';
import type {
  HaciendaQueryStatusInput,
  HaciendaSubmissionPort,
  HaciendaSubmissionResult,
  HaciendaSubmitSignedDocumentInput,
} from '../../application/submission/ports/hacienda-submission.port';

export type MockHaciendaSubmissionScenario =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'RECEIVED_PROCESSING_ACCEPTED'
  | 'PROCESSING_THEN_ACCEPTED'
  | 'TIMEOUT_UNKNOWN'
  | 'TIMEOUT_THEN_REJECTED'
  | 'RATE_LIMIT'
  | 'RATE_LIMIT_THEN_ACCEPTED'
  | 'PROVIDER_5XX'
  | 'PROVIDER_5XX_THEN_ACCEPTED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_EXPIRED_THEN_ACCEPTED'
  | 'MALFORMED_RESPONSE';

interface ScenarioState {
  readonly scenario: MockHaciendaSubmissionScenario;
  readonly submitCount: number;
  readonly statusQueryCount: number;
}

export interface MockHaciendaCallCounts {
  readonly submitCount: number;
  readonly statusQueryCount: number;
}

@Injectable()
export class MockHaciendaSubmissionAdapter implements HaciendaSubmissionPort {
  private readonly scenariosByClave = new Map<string, ScenarioState>();

  setScenario(clave: string, scenario: MockHaciendaSubmissionScenario): void {
    this.scenariosByClave.set(clave, { scenario, submitCount: 0, statusQueryCount: 0 });
  }

  getCallCounts(clave: string): MockHaciendaCallCounts {
    const state = this.getScenario(clave);
    return { submitCount: state.submitCount, statusQueryCount: state.statusQueryCount };
  }

  clearScenarios(): void {
    this.scenariosByClave.clear();
  }

  async submitSignedDocument(
    input: HaciendaSubmitSignedDocumentInput,
  ): Promise<HaciendaSubmissionResult> {
    const scenario = this.getScenario(input.clave);
    const nextSubmitCount = scenario.submitCount + 1;
    this.scenariosByClave.set(input.clave, { ...scenario, submitCount: nextSubmitCount });

    switch (scenario.scenario) {
      case 'TIMEOUT_UNKNOWN':
        return {
          kind: 'AMBIGUOUS_FAILURE',
          nextStatus: 'POST_OUTCOME_UNKNOWN',
          normalizedErrorCode: 'POST_OUTCOME_UNKNOWN',
          sanitizedErrorMessage: 'Mock ambiguous timeout after possible provider send.',
        };
      case 'RATE_LIMIT_THEN_ACCEPTED':
        return nextSubmitCount > 1 ? this.acknowledged(input.clave) : this.rateLimitResult();
      case 'RATE_LIMIT':
        return this.rateLimitResult();
      case 'PROVIDER_5XX_THEN_ACCEPTED':
        return nextSubmitCount > 1 ? this.acknowledged(input.clave) : this.provider5xxResult();
      case 'PROVIDER_5XX':
        return this.provider5xxResult();
      case 'TOKEN_EXPIRED_THEN_ACCEPTED':
        return nextSubmitCount > 1 ? this.acknowledged(input.clave) : this.tokenExpiredResult();
      case 'TOKEN_EXPIRED':
        return this.tokenExpiredResult();
      case 'MALFORMED_RESPONSE':
        return {
          kind: 'NON_RETRYABLE_FAILURE',
          nextStatus: 'MANUAL_REVIEW_REQUIRED',
          normalizedErrorCode: 'HACIENDA_MALFORMED_RESPONSE',
          sanitizedErrorMessage: 'Mock malformed Hacienda response.',
        };
      default:
        return this.acknowledged(input.clave);
    }
  }

  async queryStatusByClave(input: HaciendaQueryStatusInput): Promise<HaciendaSubmissionResult> {
    const state = this.getScenario(input.clave);
    const nextState: ScenarioState = {
      scenario: state.scenario,
      submitCount: state.submitCount,
      statusQueryCount: state.statusQueryCount + 1,
    };
    this.scenariosByClave.set(input.clave, nextState);

    switch (state.scenario) {
      case 'REJECTED':
        return this.terminalResult('REJECTED', 'rechazado', input.clave);
      case 'TIMEOUT_THEN_REJECTED':
        return this.terminalResult('REJECTED', 'rechazado', input.clave);
      case 'RECEIVED_PROCESSING_ACCEPTED':
        if (state.statusQueryCount === 0) {
          return { kind: 'PROCESSING', nextStatus: 'PROCESSING', providerStatus: 'recibido' };
        }
        if (state.statusQueryCount === 1) {
          return { kind: 'PROCESSING', nextStatus: 'PROCESSING', providerStatus: 'procesando' };
        }
        return this.terminalResult('ACCEPTED', 'aceptado', input.clave);
      case 'PROCESSING_THEN_ACCEPTED':
        if (state.statusQueryCount === 0) {
          return { kind: 'PROCESSING', nextStatus: 'PROCESSING', providerStatus: 'procesando' };
        }
        return this.terminalResult('ACCEPTED', 'aceptado', input.clave);
      case 'RATE_LIMIT_THEN_ACCEPTED':
      case 'PROVIDER_5XX_THEN_ACCEPTED':
      case 'TOKEN_EXPIRED_THEN_ACCEPTED':
      case 'TIMEOUT_UNKNOWN':
      case 'ACCEPTED':
      default:
        return this.terminalResult('ACCEPTED', 'aceptado', input.clave);
    }
  }

  private getScenario(clave: string): ScenarioState {
    return (
      this.scenariosByClave.get(clave) ?? {
        scenario: 'ACCEPTED',
        submitCount: 0,
        statusQueryCount: 0,
      }
    );
  }

  private acknowledged(clave: string): HaciendaSubmissionResult {
    return {
      kind: 'ACKNOWLEDGED',
      nextStatus: 'ACKNOWLEDGED',
      httpStatus: 201,
      providerLocation: `mock://hacienda/recepcion/${clave}`,
      providerReference: clave,
    };
  }

  private rateLimitResult(): HaciendaSubmissionResult {
    return {
      kind: 'RETRYABLE_FAILURE',
      nextStatus: 'TECHNICAL_RETRY_PENDING',
      httpStatus: 429,
      normalizedErrorCode: 'HACIENDA_RATE_LIMIT',
      sanitizedErrorMessage: 'Mock Hacienda rate limit.',
      rateLimit: { limit: '10', remaining: '0', reset: '60', retryAfterSeconds: 60 },
    };
  }

  private provider5xxResult(): HaciendaSubmissionResult {
    return {
      kind: 'RETRYABLE_FAILURE',
      nextStatus: 'TECHNICAL_RETRY_PENDING',
      httpStatus: 503,
      normalizedErrorCode: 'HACIENDA_UNAVAILABLE',
      sanitizedErrorMessage: 'Mock Hacienda unavailable.',
    };
  }

  private tokenExpiredResult(): HaciendaSubmissionResult {
    return {
      kind: 'RETRYABLE_FAILURE',
      nextStatus: 'TECHNICAL_RETRY_PENDING',
      httpStatus: 401,
      normalizedErrorCode: 'HACIENDA_TOKEN_EXPIRED',
      sanitizedErrorMessage: 'Mock expired Hacienda bearer token.',
    };
  }

  private terminalResult(
    kind: 'ACCEPTED' | 'REJECTED',
    providerStatus: 'aceptado' | 'rechazado',
    clave: string,
  ): HaciendaSubmissionResult {
    const responseXml = `<MensajeHacienda><Clave>${clave}</Clave><Estado>${providerStatus}</Estado></MensajeHacienda>`;

    return {
      kind,
      nextStatus: kind,
      providerStatus,
      responseArtifact: {
        content: Buffer.from(responseXml, 'utf8'),
        contentType: 'application/xml',
      },
    };
  }
}
