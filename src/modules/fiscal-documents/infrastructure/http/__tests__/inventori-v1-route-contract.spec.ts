import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { SCOPES_KEY } from '../../../../../api/decorators/scopes.decorator';
import { ApiKeyAuthGuard } from '../../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../../api/guards/scope.guard';
import {
  FiscalOnboardingM2MV1Controller,
  FiscalOnboardingServiceBootstrapV1Controller,
} from '../../../../fiscal-onboarding/infrastructure/http/fiscal-onboarding-v1.controller';
import { INVENTORI_FISCAL_PROFILE } from '../../../../fiscal-onboarding/domain/inventori-fiscal-profile';
import { FiscalDocumentsController } from '../fiscal-documents.controller';
import { FiscalIdentityLookupController } from '../fiscal-identity-lookup.controller';
import { FiscalIdentityEvidenceLookupController } from '../fiscal-identity-evidence-lookup.controller';
import { FiscalSubmissionController } from '../fiscal-submission.controller';

type Controller = new (...args: never[]) => object;

const lockedRoutes: ReadonlyArray<{
  controller: Controller;
  handler: string;
  method: RequestMethod;
  path: string;
  scopes?: readonly string[];
}> = [
  {
    controller: FiscalOnboardingServiceBootstrapV1Controller,
    handler: 'provision',
    method: RequestMethod.POST,
    path: '/api/v1/fiscal-onboarding/v1/bootstrap',
    scopes: ['fiscal-bootstrap:provision'],
  },
  {
    controller: FiscalOnboardingM2MV1Controller,
    handler: 'getIssuer',
    method: RequestMethod.GET,
    path: '/api/v1/companies/:companyId/fiscal-onboarding/v1/:environment/issuer',
    scopes: ['fiscal-issuer:read'],
  },
  {
    controller: FiscalOnboardingM2MV1Controller,
    handler: 'getFiscalProfile',
    method: RequestMethod.GET,
    path: '/api/v1/companies/:companyId/fiscal-onboarding/v1/:environment/profile',
    scopes: ['fiscal-profile:read'],
  },
  {
    controller: FiscalOnboardingM2MV1Controller,
    handler: 'readiness',
    method: RequestMethod.GET,
    path: '/api/v1/companies/:companyId/fiscal-onboarding/v1/:environment/readiness',
    scopes: ['fiscal-readiness:read'],
  },
  {
    controller: FiscalOnboardingM2MV1Controller,
    handler: 'initiateTestInvoice',
    method: RequestMethod.POST,
    path: '/api/v1/companies/:companyId/fiscal-onboarding/v1/:environment/test-invoices',
    scopes: ['invoices:write', 'invoices:read'],
  },
  {
    controller: FiscalDocumentsController,
    handler: 'createInvoice',
    method: RequestMethod.POST,
    path: '/api/v1/companies/:companyId/fiscal-documents/:environment/invoices',
    scopes: ['invoices:write'],
  },
  {
    controller: FiscalIdentityLookupController,
    handler: 'findByIdempotency',
    method: RequestMethod.GET,
    path: '/api/v1/companies/:companyId/fiscal-documents/:environment/identity-by-idempotency',
  },
  {
    controller: FiscalIdentityEvidenceLookupController,
    handler: 'findByFiscalEvidence',
    method: RequestMethod.POST,
    path: '/api/v1/companies/:companyId/fiscal-documents/:environment/identity-by-fiscal-evidence',
  },
  {
    controller: FiscalSubmissionController,
    handler: 'submitInvoice',
    method: RequestMethod.POST,
    path: '/api/v1/companies/:companyId/fiscal-documents/:environment/invoices/:id/submit',
    scopes: ['invoices:write'],
  },
];

describe('Inventori v1 route contract', () => {
  it('retains the M2M profile identifier', () => {
    expect(INVENTORI_FISCAL_PROFILE).toBe('inventori-fiscal-v1');
  });

  it.each(lockedRoutes)('$method $path', ({ controller, handler, method, path, scopes }) => {
    const classPath = Reflect.getMetadata(PATH_METADATA, controller) as string;
    const action = (controller.prototype as Record<string, object>)[handler];
    expect(typeof action).toBe('function');
    const actionPath = Reflect.getMetadata(PATH_METADATA, action) as string;
    const actionMethod = Reflect.getMetadata(METHOD_METADATA, action) as RequestMethod;
    expect(actionMethod).toBe(method);
    const routePath = [classPath, actionPath]
      .filter(Boolean)
      .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/');
    expect('/api/v1/' + routePath).toBe(path);
    expect(Reflect.getMetadata(SCOPES_KEY, action)).toEqual(scopes);
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[];
    expect(guards).toContain(ApiKeyAuthGuard);
    expect(guards).toContain(ScopeGuard);
  });
});
