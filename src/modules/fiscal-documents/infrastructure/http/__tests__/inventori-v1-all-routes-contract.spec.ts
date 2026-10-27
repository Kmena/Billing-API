import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { SCOPES_KEY } from '../../../../../api/decorators/scopes.decorator';
import { ApiKeyAuthGuard } from '../../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../../api/guards/scope.guard';
import { FiscalOnboardingM2MController as LegacyFiscalOnboardingController } from '../../../../companies/infrastructure/http/taxpayer-verification.controller';
import { HaciendaCredentialsM2MController } from '../../../../hacienda-connection/infrastructure/http/hacienda-credentials-m2m.controller';
import {
  FiscalOnboardingM2MV1Controller,
  FiscalOnboardingServiceBootstrapV1Controller,
} from '../../../../fiscal-onboarding/infrastructure/http/fiscal-onboarding-v1.controller';
import { AcceptedFiscalPackageResendController } from '../accepted-fiscal-package-resend.controller';
import { FiscalArtifactsController } from '../fiscal-artifacts.controller';
import { FiscalDocumentsController } from '../fiscal-documents.controller';
import { FiscalIdentityEvidenceLookupController } from '../fiscal-identity-evidence-lookup.controller';
import { FiscalIdentityLookupController } from '../fiscal-identity-lookup.controller';
import { FiscalPublicDocumentsController } from '../fiscal-public-documents.controller';
import { FiscalSubmissionController } from '../fiscal-submission.controller';
import { FiscalXmlController } from '../fiscal-xml.controller';

type RoutePair = [string, string];
type ControllerType = new (...args: never[]) => object;
type Route = {
  method: string;
  path: string;
  controller: string;
  handler: string;
  guards: string[];
  scopes: string[];
  httpCode: number | null;
};

const controllers: ControllerType[] = [
  LegacyFiscalOnboardingController,
  HaciendaCredentialsM2MController,
  FiscalOnboardingServiceBootstrapV1Controller,
  FiscalOnboardingM2MV1Controller,
  FiscalDocumentsController,
  FiscalIdentityLookupController,
  FiscalIdentityEvidenceLookupController,
  FiscalXmlController,
  FiscalSubmissionController,
  AcceptedFiscalPackageResendController,
  FiscalPublicDocumentsController,
  FiscalArtifactsController,
];

const normalize = (path: string) => path.replace(/^\/+|\/+$/g, '').replace(/:[^/]+/g, ':param');

function actualRoutes(): Route[] {
  return controllers.flatMap((controller) => {
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as Array<{
      name: string;
    }>;
    return Object.getOwnPropertyNames(controller.prototype).flatMap((handler) => {
      const action = (controller.prototype as Record<string, unknown>)[handler];
      if (typeof action !== 'function') return [];
      const method = Reflect.getMetadata(METHOD_METADATA, action) as RequestMethod | undefined;
      if (method === undefined) return [];
      const suffix = Reflect.getMetadata(PATH_METADATA, action) as string | undefined;
      const actionGuards = (Reflect.getMetadata(GUARDS_METADATA, action) ?? []) as Array<{
        name: string;
      }>;
      const scopes = (Reflect.getMetadata(SCOPES_KEY, action) ?? []) as string[];
      return [
        {
          method: RequestMethod[method],
          path: normalize([base, suffix].filter(Boolean).join('/')),
          controller: controller.name,
          handler,
          guards: [...classGuards, ...actionGuards].map((guard) => guard.name),
          scopes,
          httpCode: (Reflect.getMetadata(HTTP_CODE_METADATA, action) as number | undefined) ?? null,
        },
      ];
    });
  });
}

describe('all 42 Inventori v1 verb/path contracts', () => {
  const manifest = JSON.parse(
    readFileSync(
      join(process.cwd(), 'docs/contracts/fixtures/inventori-v1-route-pairs.w1-d0.json'),
      'utf8',
    ),
  ) as { groups: Record<string, RoutePair[]> };
  const expected = Object.values(manifest.groups).flat();
  const routes = actualRoutes();

  it('pins the eight consumer route groups and exactly 42 distinct pairs', () => {
    expect(Object.values(manifest.groups).map((group) => group.length)).toEqual([
      4, 1, 4, 3, 4, 7, 9, 10,
    ]);
    expect(expected).toHaveLength(42);
    expect(new Set(expected.map(([method, path]) => `${method} ${normalize(path)}`)).size).toBe(42);
  });

  it('finds each consumer pair exactly once in current Nest controller metadata', () => {
    for (const [method, path] of expected) {
      const matches = routes.filter(
        (route) => route.method === method && route.path === normalize(path),
      );
      expect({ method, path, matches: matches.length }).toEqual({ method, path, matches: 1 });
    }
  });

  it('locks current guards, scopes, handlers and HTTP codes for the 42 pairs', () => {
    const locked = expected.map(([method, path]) => {
      const route = routes.find(
        (candidate) => candidate.method === method && candidate.path === normalize(path),
      );
      expect(route).toBeDefined();
      expect(route!.guards).toContain(ApiKeyAuthGuard.name);
      expect(route!.guards).toContain(ScopeGuard.name);
      return { method, path: normalize(path), ...route };
    });
    expect(locked).toMatchSnapshot();
  });
});
