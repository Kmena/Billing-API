import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// ─── Economic Activity Response ─────────────────────────────────────────────

export class EconomicActivityResponseDto {
  @ApiProperty({ example: 'uuid-here' })
  id!: string;

  @ApiProperty({ example: '9609.0' })
  code!: string;

  @ApiProperty({ example: 'Otras actividades de servicios personales n.c.p.' })
  description!: string;

  @ApiProperty({ example: 'A', description: 'A=active, I=inactive (from Hacienda)' })
  haciendaStatus!: string;

  @ApiPropertyOptional({ example: 'P', description: 'P=principal, S=secondary' })
  haciendaKind!: string | null;

  @ApiProperty({ example: true, description: 'Company-controlled Billing issuance flag' })
  billingEnabled!: boolean;

  @ApiProperty()
  verifiedAt!: Date;

  @ApiProperty()
  lastSeenAt!: Date;

  @ApiProperty({ example: 'HACIENDA_FE_AE' })
  verificationSource!: string;
}

// ─── Taxpayer Verification Response ─────────────────────────────────────────

export class TaxpayerVerificationResponseDto {
  @ApiProperty()
  companyId!: string;

  @ApiProperty({ example: 'PERSONA FISICA DEMO' })
  haciendaName!: string;

  @ApiProperty({ example: 'VERIFIED' })
  haciendaVerificationStatus!: string;

  @ApiProperty()
  haciendaVerifiedAt!: Date;

  @ApiPropertyOptional({ example: 'Inscrito' })
  haciendaTaxSituation!: string | null;

  @ApiProperty({ example: false, description: 'DEC-003: warning only, not a hard blocker' })
  moroso!: boolean;

  @ApiProperty({ example: false, description: 'DEC-004: warning only, not a hard blocker' })
  omiso!: boolean;

  @ApiPropertyOptional({
    description: 'Auto-selected default activity id (when exactly one valid activity)',
  })
  autoSelectedDefaultActivityId!: string | null;

  @ApiProperty({ type: [EconomicActivityResponseDto] })
  activities!: EconomicActivityResponseDto[];
}

// ─── Taxpayer Verification Status Response ───────────────────────────────────

export class TaxpayerVerificationStatusResponseDto {
  @ApiProperty()
  companyId!: string;

  @ApiPropertyOptional()
  haciendaName!: string | null;

  @ApiPropertyOptional()
  haciendaVerificationStatus!: string | null;

  @ApiPropertyOptional()
  haciendaVerifiedAt!: Date | null;

  @ApiPropertyOptional()
  haciendaTaxSituation!: string | null;

  @ApiPropertyOptional()
  moroso!: boolean | null;

  @ApiPropertyOptional()
  omiso!: boolean | null;

  @ApiPropertyOptional()
  defaultEconomicActivityId!: string | null;

  @ApiProperty({ type: [EconomicActivityResponseDto] })
  activities!: EconomicActivityResponseDto[];
}

// ─── Set Activity Enabled Request ────────────────────────────────────────────

export class SetActivityBillingEnabledRequestDto {
  @ApiProperty({
    example: true,
    description: 'Enable (true) or disable (false) this activity for Billing issuance',
  })
  @IsBoolean()
  billingEnabled!: boolean;
}

// ─── Set Default Activity Request ────────────────────────────────────────────

export class SetDefaultEconomicActivityRequestDto {
  @ApiProperty({ example: '9609.0', description: 'Activity code to set as default' })
  @IsString()
  @IsNotEmpty()
  code!: string;
}

// ─── Set Default Activity Response ───────────────────────────────────────────

export class SetDefaultEconomicActivityResponseDto {
  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  defaultEconomicActivityId!: string;

  @ApiProperty({ example: '9609.0' })
  code!: string;
}

// ─── Fiscal Readiness Response (P0 extended) ─────────────────────────────────

export class FiscalReadinessResponseDto {
  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  environment!: string;

  @ApiProperty()
  readyToIssue!: boolean;

  @ApiProperty({ type: [String], description: 'Hard blockers — each blocks issuance' })
  reasonCodes!: string[];

  @ApiProperty({ type: [String], description: 'Warnings — informational only, do not block' })
  warnings!: string[];

  @ApiProperty()
  checkedAt!: Date;
}

// ─── Taxpayer Verification Status (M2M alias) ────────────────────────────────

export class FiscalOnboardingStatusResponseDto {
  @ApiProperty()
  companyId!: string;

  @ApiPropertyOptional()
  haciendaVerificationStatus!: string | null;

  @ApiPropertyOptional()
  haciendaVerifiedAt!: Date | null;

  @ApiPropertyOptional()
  haciendaTaxSituation!: string | null;

  @ApiProperty({ description: 'moroso flag from Hacienda — DEC-003 warning only' })
  moroso!: boolean | null;

  @ApiProperty({ description: 'omiso flag from Hacienda — DEC-004 warning only' })
  omiso!: boolean | null;

  @ApiPropertyOptional()
  defaultEconomicActivityId!: string | null;

  @ApiProperty({ type: [EconomicActivityResponseDto] })
  activities!: EconomicActivityResponseDto[];
}

// ─── Fiscal Profile Patch (user-provided address/contact) ───────────────────
// Only user-provided fields — does NOT accept verificationSource or verified flag.

export class PatchFiscalProfileRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  province?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  canton?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  district?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barrio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  otrasSenas?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phoneCountryCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
