import { AggregateRoot } from '../../../shared/domain/aggregate-root';
import { IdentificationNumber } from '../value-objects/identification-number.vo';
import {
  IdentificationType,
  IdentificationTypeValue,
} from '../value-objects/identification-type.vo';

export type CompanyStatus = 'ACTIVE' | 'INACTIVE';

interface CompanyProps {
  tenantId: string;
  legalName: string;
  tradeName?: string;
  identificationType: IdentificationType;
  identificationNumber: IdentificationNumber;
  status: CompanyStatus;
}

export interface CompanyReconstructProps {
  id: string;
  tenantId: string;
  legalName: string;
  tradeName?: string | null;
  identificationType: IdentificationTypeValue;
  identificationNumber: string;
  status: CompanyStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class Company extends AggregateRoot<string> {
  private readonly _tenantId: string;
  private _legalName: string;
  private _tradeName?: string;
  private readonly _identificationType: IdentificationType;
  private readonly _identificationNumber: IdentificationNumber;
  private _status: CompanyStatus;

  private constructor(id: string, props: CompanyProps, createdAt?: Date, updatedAt?: Date) {
    super(id, createdAt, updatedAt);
    this._tenantId = props.tenantId;
    this._legalName = props.legalName;
    this._tradeName = props.tradeName;
    this._identificationType = props.identificationType;
    this._identificationNumber = props.identificationNumber;
    this._status = props.status;
  }

  get tenantId(): string {
    return this._tenantId;
  }

  get legalName(): string {
    return this._legalName;
  }

  get tradeName(): string | undefined {
    return this._tradeName;
  }

  get identificationType(): IdentificationTypeValue {
    return this._identificationType.value;
  }

  get identificationNumber(): string {
    return this._identificationNumber.value;
  }

  get status(): CompanyStatus {
    return this._status;
  }

  static create(
    id: string,
    tenantId: string,
    legalName: string,
    identificationType: string,
    identificationNumber: string,
    tradeName?: string,
  ): Company {
    const idType = IdentificationType.create(identificationType);
    const idNumber = IdentificationNumber.create(identificationNumber, idType.value);

    return new Company(id, {
      tenantId,
      legalName: legalName.trim(),
      tradeName: tradeName?.trim(),
      identificationType: idType,
      identificationNumber: idNumber,
      status: 'ACTIVE',
    });
  }

  static reconstruct(props: CompanyReconstructProps): Company {
    const idType = IdentificationType.create(props.identificationType);
    const idNumber = IdentificationNumber.create(props.identificationNumber, idType.value);

    return new Company(
      props.id,
      {
        tenantId: props.tenantId,
        legalName: props.legalName,
        tradeName: props.tradeName ?? undefined,
        identificationType: idType,
        identificationNumber: idNumber,
        status: props.status,
      },
      props.createdAt,
      props.updatedAt,
    );
  }
}
