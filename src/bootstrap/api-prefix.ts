import { INestApplication, RequestMethod } from '@nestjs/common';

/** Keep the live v1 prefix while allowing explicitly versioned future controllers. */
export function configureApiPrefixes(app: Pick<INestApplication, 'setGlobalPrefix'>): void {
  app.setGlobalPrefix('api/v1', {
    exclude: [
      'health',
      'health/ready',
      'health/live',
      { path: 'api/v2/(.*)', method: RequestMethod.ALL },
    ],
  });
}
