import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { BffUser } from './bff-authz';

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
    const user = this.resolveUser(request);
    this.assertRateLimit(request, user.actor);
    request.user = user;
    response.setHeader('x-trendcut-bff', 'true');
    return true;
  }

  private resolveUser(request: any): BffUser {
    if (String(process.env.BFF_AUTH_DISABLED || '').toLowerCase() === 'true') {
      return {
        actor: this.resolveDevActor(request),
        roles: this.parseRoles(process.env.BFF_DEV_ROLES || 'admin'),
        tenantId: this.optionalString(process.env.BFF_DEV_TENANT_ID),
        authMode: 'dev'
      };
    }

    const token = this.resolveToken(request);
    if (!token) {
      throw new ForbiddenException({ code: 'BFF_AUTH_REQUIRED', message: 'BFF API token required' });
    }

    const principal = this.resolvePrincipal(token);
    if (!principal) {
      throw new ForbiddenException({ code: 'BFF_AUTH_REQUIRED', message: 'BFF API token required' });
    }
    return principal;
  }

  private resolveToken(request: any): string {
    const bearer = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const headerToken = String(request.headers['x-bff-api-token'] || '').trim();
    return bearer || headerToken;
  }

  private resolvePrincipal(token: string): BffUser | null {
    const tokenMap = this.parseTokenMap();
    if (Object.keys(tokenMap).length > 0) {
      const user = tokenMap[token];
      return user ? { ...user, authMode: 'token' } : null;
    }

    const expected = String(process.env.BFF_API_TOKEN || '').trim();
    if (!expected) {
      throw new ServiceUnavailableException({ code: 'BFF_AUTH_NOT_CONFIGURED', message: 'BFF auth token is not configured' });
    }
    if (token !== expected) return null;
    return {
      actor: this.optionalString(process.env.BFF_ACTOR) || 'service-admin',
      roles: this.parseRoles(process.env.BFF_ROLES || 'admin'),
      tenantId: this.optionalString(process.env.BFF_TENANT_ID),
      authMode: 'token'
    };
  }

  private parseTokenMap(): Record<string, Omit<BffUser, 'authMode'>> {
    const raw = String(process.env.BFF_API_KEYS || '').trim();
    if (!raw) return {};
    let parsed: Record<string, { actor?: unknown; roles?: unknown; tenant_id?: unknown; tenantId?: unknown }>;
    try {
      parsed = JSON.parse(raw) as Record<string, { actor?: unknown; roles?: unknown; tenant_id?: unknown; tenantId?: unknown }>;
    } catch (error) {
      throw new ServiceUnavailableException({ code: 'BFF_AUTH_NOT_CONFIGURED', message: 'BFF_API_KEYS must be valid JSON' });
    }
    const result: Record<string, Omit<BffUser, 'authMode'>> = {};
    for (const [token, value] of Object.entries(parsed)) {
      if (!token || !value || typeof value !== 'object') continue;
      result[token] = {
        actor: this.optionalString(value.actor) || 'service-user',
        roles: Array.isArray(value.roles) ? value.roles.map((role) => String(role).trim()).filter(Boolean) : ['admin'],
        tenantId: this.optionalString(value.tenant_id) || this.optionalString(value.tenantId)
      };
    }
    return result;
  }

  private resolveDevActor(request: any): string {
    const trustHeaders = String(process.env.BFF_TRUSTED_ACTOR_HEADERS || '').toLowerCase() === 'true';
    if (!trustHeaders) return 'dev-user';
    return this.optionalString(request.headers['x-user-id']) || this.optionalString(request.headers['x-actor']) || 'dev-user';
  }

  private parseRoles(value: string): string[] {
    return String(value || '').split(',').map((role) => role.trim()).filter(Boolean);
  }

  private optionalString(value: unknown): string | undefined {
    const text = String(value || '').trim().slice(0, 160);
    return text || undefined;
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
