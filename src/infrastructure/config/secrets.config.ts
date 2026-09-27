import { registerAs } from '@nestjs/config';

export interface SecretsConfig {
  provider: 'env' | 'ssm';
  ssmParameterPrefix: string;
  awsRegion: string;
  ssmEndpoint?: string;
}

export default registerAs('secrets', (): SecretsConfig => ({
  provider: (process.env.SECRET_PROVIDER as 'env' | 'ssm') ?? 'ssm',
  ssmParameterPrefix: process.env.SSM_PARAMETER_PREFIX ?? '/billing',
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  ssmEndpoint: process.env.AWS_SSM_ENDPOINT,
}));
