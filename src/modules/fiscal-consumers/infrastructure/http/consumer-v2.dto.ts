import {
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  CONSUMER_V2_ASSOCIATION_CONTRACT,
  CONSUMER_V2_LAB_SCOPES,
  FiscalEnvironmentV2,
  ConsumerV2Scope,
} from '../../domain/consumer-v2.policy';
import { ConsumerV2Operation } from '../../domain/consumer-v2-idempotency.policy';

/** Registered only by the isolated laboratory module; not by AppModule. */
export class CreateConsumerAssociationV2Dto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^\S(?:.*\S)?$/)
  externalConsumerKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^\S(?:.*\S)?$/)
  externalCompanyKey!: string;

  @IsUUID('4')
  companyId!: string;

  @IsIn(['SANDBOX', 'PRODUCTION'])
  environment!: FiscalEnvironmentV2;

  @Equals(CONSUMER_V2_ASSOCIATION_CONTRACT)
  profileVersion!: typeof CONSUMER_V2_ASSOCIATION_CONTRACT;
}

export class CreateConsumerKeyV2Dto {
  @IsUUID('4')
  associationId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(CONSUMER_V2_LAB_SCOPES, { each: true })
  scopes!: ConsumerV2Scope[];

  @IsISO8601({ strict: true })
  expiresAt!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  rotationEndsAt?: string;
}

/** A new external issuer key preserves the immutable historical mapping. */
export class ReassignConsumerIssuerV2Dto {
  @IsUUID('4')
  targetCompanyId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^\S(?:.*\S)?$/)
  newExternalCompanyKey!: string;
}

export class LookupConsumerOperationV2Dto {
  @IsIn(['CREATE_INVOICE'])
  operation!: ConsumerV2Operation;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^\S(?:.*\S)?$/)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[a-z][a-z\d.-]*$/)
  requestHashVersion!: string;

  @Matches(/^[a-f\d]{64}$/i)
  requestHash!: string;
}
