import { registerAs } from '@nestjs/config';

export interface SecretsConfig {
  provider: 'env' | 'ssm' | 'local-encrypted';
  ssmParameterPrefix: string;
  awsRegion: string;
  ssmEndpoint?: string;
  localStorePath?: string;
  localMasterKeyPath?: string;
  localRequiredMarker?: string;
}

export default registerAs('secrets', (): SecretsConfig => ({
  provider: (process.env.SECRET_PROVIDER as 'env' | 'ssm' | 'local-encrypted') ?? 'ssm',
  ssmParameterPrefix: process.env.SSM_PARAMETER_PREFIX ?? '/billing',
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  ssmEndpoint: process.env.AWS_SSM_ENDPOINT,
  localStorePath: process.env.LOCAL_SECRET_STORE_PATH,
  localMasterKeyPath: process.env.LOCAL_SECRET_STORE_MASTER_KEY_PATH,
  localRequiredMarker:
    process.env.LOCAL_SECRET_STORE_REQUIRED_MARKER ?? '.billing-secret-store-root',
}));
