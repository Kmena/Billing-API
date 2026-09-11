import { AggregateRoot } from '../../../shared/domain/aggregate-root';

export type HaciendaEnvironment = 'PRODUCTION' | 'SANDBOX';
export type HaciendaConnectionStatus =
  | 'NOT_CONFIGURED'
  | 'PENDING_VALIDATION'
  | 'CONNECTED'
  | 'INVALID_CREDENTIALS'
  | 'UNAVAILABLE'
  | 'DISABLED';

export interface HaciendaConnectionProps {
  id: string;
  tenantId: string;
  companyId: string;
  environment: HaciendaEnvironment;
  status: HaciendaConnectionStatus;
  secretReference: string;
  lastValidatedAt?: Date;
  lastSuccessfulAuthAt?: Date;
  lastValidationErrorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class HaciendaConnection extends AggregateRoot<string> {
  private constructor(private readonly props: HaciendaConnectionProps) {
    super(props.id, props.createdAt, props.updatedAt);
  }

  get tenantId(): string {
    return this.props.tenantId;
  }
  get companyId(): string {
    return this.props.companyId;
  }
  get environment(): HaciendaEnvironment {
    return this.props.environment;
  }
  get status(): HaciendaConnectionStatus {
    return this.props.status;
  }
  get secretReference(): string {
    return this.props.secretReference;
  }
  get lastValidatedAt(): Date | undefined {
    return this.props.lastValidatedAt;
  }
  get lastSuccessfulAuthAt(): Date | undefined {
    return this.props.lastSuccessfulAuthAt;
  }
  get lastValidationErrorCode(): string | undefined {
    return this.props.lastValidationErrorCode;
  }

  static configure(
    id: string,
    tenantId: string,
    companyId: string,
    environment: HaciendaEnvironment,
    secretReference: string,
    _existedBefore: boolean,
  ): HaciendaConnection {
    if (!secretReference) throw new Error('secretReference is required');
    return new HaciendaConnection({
      id,
      tenantId,
      companyId,
      environment,
      secretReference,
      status: 'PENDING_VALIDATION',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  static reconstruct(props: HaciendaConnectionProps): HaciendaConnection {
    return new HaciendaConnection(props);
  }

  markConnected(at: Date): void {
    this.assertNotDisabled();
    this.props.status = 'CONNECTED';
    this.props.lastValidatedAt = at;
    this.props.lastSuccessfulAuthAt = at;
    this.props.lastValidationErrorCode = undefined;
    this.updatedAt = at;
  }
  markInvalidCredentials(errorCode: string, at: Date): void {
    this.assertNotDisabled();
    this.props.status = 'INVALID_CREDENTIALS';
    this.props.lastValidatedAt = at;
    this.props.lastValidationErrorCode = errorCode;
    this.updatedAt = at;
  }
  markUnavailable(errorCode: string, at: Date): void {
    this.assertNotDisabled();
    this.props.status = 'UNAVAILABLE';
    this.props.lastValidatedAt = at;
    this.props.lastValidationErrorCode = errorCode;
    this.updatedAt = at;
  }
  disable(): void {
    this.props.status = 'DISABLED';
    this.updatedAt = new Date();
  }
  private assertNotDisabled(): void {
    if (this.props.status === 'DISABLED') throw new Error('Hacienda connection is disabled');
  }
}
