import { SetMetadata } from '@nestjs/common';
import { ConsumerV2Scope } from '../../domain/consumer-v2.policy';

export const CONSUMER_V2_SCOPE_METADATA = 'consumer-v2-required-scope';
export const ConsumerV2RequiredScope = (scope: ConsumerV2Scope) =>
  SetMetadata(CONSUMER_V2_SCOPE_METADATA, scope);
