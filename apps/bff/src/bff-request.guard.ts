import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface RateBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class BffRequestGuard implements CanActivate {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly windowMs = 60_000;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    if (request.path === '/health' || request.path === '/internal/health') {
      return true;
    }
    const actor = this.resolveActor(request);
    this.assertApiToken(request);
    this.assertRateLimit(request, actor);
    request.user = { actor };
    response.setHeader('x-trendcut-bff', 'true');
    return true;
  }

  private resolveActor(request: any): string {
    return String(request.headers['x-user-id'] || request.headers['x-actor'] || 'anonymous').trim().slice(0, 160) || 'anonymous';
  }

  private assertApiToken(request: any): void {
    const expected = String(process.env.BFF_API_TOKEN || '').trim();
    if (!expected) return;
    const bearer = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const headerToken = String(request.headers['x-bff-api-token'] || '').trim();
    if (bearer !== expected && headerToken !== expected) {
      throw new ForbiddenException({ code: 'BFF_AUTH_REQUIRED', message: 'BFF API token required' });
    }
  }

  private assertRateLimit(request: any, actor: string): void {
    const max = Number(process.env.BFF_RATE_LIMIT_PER_MINUTE || 120);
    if (!Number.isFinite(max) || max <= 0) return;
    const now = Date.now();
    const key = `${request.ip || request.socket?.remoteAddress || 'unknown'}:${actor}`;
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    bucket.count += 1;
    if (bucket.count > max) {
      throw new HttpException({ code: 'BFF_RATE_LIMITED', message: 'Rate limit exceeded' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
