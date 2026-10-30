import 'reflect-metadata';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Technical W2-A transport cap, not an approved fiscal scale or rounding rule. */
export const W2A_DECIMAL_PATTERN = /^\d{1,18}(?:\.\d{1,10})?$/;
const OPAQUE_PATTERN = /^\S(?:.*\S)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class W2ASourceReferenceDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(128)
  @Matches(OPAQUE_PATTERN)
  affiliationId?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(128)
  @Matches(OPAQUE_PATTERN)
  periodId?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(128)
  @Matches(OPAQUE_PATTERN)
  allocationId?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(128)
  @Matches(OPAQUE_PATTERN)
  paymentId?: string;
}

export class W2AServicePeriodDto {
  @IsString()
  @Matches(DATE_PATTERN)
  startsOn!: string;

  @IsString()
  @Matches(DATE_PATTERN)
  endsOn!: string;
}

export class W2AReceiverDto {
  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  identificationType!: string;

  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  identificationNumber!: string;

  @IsString()
  @MaxLength(200)
  @Matches(OPAQUE_PATTERN)
  name!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export class W2ADiscountDto {
  @IsString()
  @Matches(W2A_DECIMAL_PATTERN)
  amount!: string;

  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  reasonCode!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  @Matches(OPAQUE_PATTERN)
  reason?: string;
}

export class W2ADeclaredTaxDto {
  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  code!: string;

  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  rateCode!: string;

  @IsString()
  @Matches(W2A_DECIMAL_PATTERN)
  rate!: string;

  @IsString()
  @Matches(W2A_DECIMAL_PATTERN)
  base!: string;

  @IsString()
  @Matches(W2A_DECIMAL_PATTERN)
  amount!: string;
}

export class W2AFiscalLineDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  lineNumber!: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => W2ASourceReferenceDto)
  source?: W2ASourceReferenceDto;

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => W2AServicePeriodDto)
  servicePeriod?: W2AServicePeriodDto;

  @IsString()
  @MaxLength(500)
  @Matches(OPAQUE_PATTERN)
  description!: string;

  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  cabysCode!: string;

  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  unitCode!: string;

  @IsString()
  @Matches(W2A_DECIMAL_PATTERN)
  quantity!: string;

  @IsString()
  @Matches(W2A_DECIMAL_PATTERN)
  unitPrice!: string;

  @IsIn(['EXCLUSIVE', 'INCLUSIVE'])
  priceInputMode!: 'EXCLUSIVE' | 'INCLUSIVE';

  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => W2ADiscountDto)
  discounts!: W2ADiscountDto[];

  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  taxTreatment!: string;

  /** Technical abuse bound only; an approved catalog must narrow it later. */
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => W2ADeclaredTaxDto)
  taxes!: W2ADeclaredTaxDto[];
}

export class W2APaymentMethodDto {
  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  code!: string;

  @IsString()
  @Matches(W2A_DECIMAL_PATTERN)
  amount!: string;
}

export class W2AFiscalReferenceDto {
  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  documentTypeCode!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(128)
  @Matches(OPAQUE_PATTERN)
  documentNumber?: string;

  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  issuedAt!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  reasonCode?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  @Matches(OPAQUE_PATTERN)
  reason?: string;
}

/** Unregistered DTO. Validation never authorizes a tax treatment or emits a document. */
export class W2AInvoiceIntentDto {
  @IsString()
  @MaxLength(128)
  @Matches(OPAQUE_PATTERN)
  externalOperationId!: string;

  @IsString()
  @MaxLength(128)
  @Matches(OPAQUE_PATTERN)
  policyVersion!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => W2AReceiverDto)
  receiver?: W2AReceiverDto;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(W2A_DECIMAL_PATTERN)
  exchangeRate?: string | null;

  @IsString()
  @MaxLength(64)
  @Matches(OPAQUE_PATTERN)
  saleCondition!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => W2AFiscalReferenceDto)
  fiscalReferences?: W2AFiscalReferenceDto[];

  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => W2APaymentMethodDto)
  paymentMethods!: W2APaymentMethodDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => W2AFiscalLineDto)
  lines!: W2AFiscalLineDto[];
}
