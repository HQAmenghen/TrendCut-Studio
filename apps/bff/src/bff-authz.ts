import { ForbiddenException } from '@nestjs/common';

export interface BffUser {
  actor: string;
  roles: string[];
  tenantId?: string;
  authMode: 'token' | 'dev';
}

export function requireRole(user: BffUser | undefined, ...roles: string[]): void {
  if (!user) {
    throw new ForbiddenException({ code: 'BFF_AUTH_REQUIRED', message: 'Authenticated BFF user required' });
  }
  if (user.roles.includes('admin')) return;
  if (roles.some((role) => user.roles.includes(role))) return;
  throw new ForbiddenException({
    code: 'BFF_FORBIDDEN',
    message: `Required role: ${roles.join(' or ')}`
  });
}
