import { IsEmail, IsIn, IsString, Length, Matches, ValidateIf } from 'class-validator';

export class ConfigureIssuerV2Dto {
  @IsString() @Length(2, 255) legalName!: string;
  @IsString() @Length(9, 20) identificationNumber!: string;
  @IsIn(['FISICA', 'JURIDICA', 'DIMEX', 'NITE'])
  identificationType!: 'FISICA' | 'JURIDICA' | 'DIMEX' | 'NITE';
}

export class AssociateCompanyV2Dto {
  @IsString()
  @Length(1, 128)
  @Matches(/^\S(?:.*\S)?$/)
  externalCompanyKey!: string;
}

export class ConfigureCredentialsV2Dto {
  @IsString() @Length(1, 100) username!: string;
  @IsString() @Length(1, 200) password!: string;
}

export class ConfigureBranchV2Dto {
  @Matches(/^\d{3}$/) branchCode!: string;
  @IsString() @Length(1, 120) branchName!: string;
  @Matches(/^\d{5}$/) terminalCode!: string;
  @IsString() @Length(1, 120) terminalName!: string;
}

/** Omitted fields are preserved. Null and empty replacements are rejected. */
export class PatchFiscalProfileV2Dto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/^[1-9]$/)
  province?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/^(0[1-9]|[1-9][0-9])$/)
  canton?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/^(0[1-9]|[1-9][0-9])$/)
  district?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(5, 50)
  barrio?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(5, 250)
  otrasSenas?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsEmail()
  @Length(3, 160)
  email?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/^\d{1,3}$/)
  phoneCountryCode?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/^\d{3,20}$/)
  phoneNumber?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 20)
  proveedorSistemas?: string;
}

export class SelectDefaultActivityV2Dto {
  @IsString() @Length(1, 20) code!: string;
}
