import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string;
        email: string;
        roles?: string[];
      };
    }
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    // In a real app, you'd verify the JWT here
    // For now, this is a placeholder that expects the token to be validated elsewhere
    const token = authHeader.slice(7);
    
    // Attach a minimal user object (in production, decode and verify JWT)
    if (token) {
      request.user = {
        sub: 'user-id',
        email: 'user@example.com',
        roles: ['user'],
      };
    }

    return !!request.user;
  }
}
