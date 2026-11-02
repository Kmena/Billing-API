import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/** Browser-originated requests must go through Afiliaciones' server-side proxy. */
@Injectable()
export class OnboardingV2OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const headers = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown> }>().headers;
    if (headers.origin !== undefined) {
      throw new ForbiddenException({ code: 'ONBOARDING_BROWSER_ORIGIN_FORBIDDEN' });
    }
    return true;
  }
}
