import { IsIn, IsString, Length, Matches } from 'class-validator';

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
