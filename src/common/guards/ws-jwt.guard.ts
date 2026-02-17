import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { AuthService } from '../../auth/auth.service';
import { AuthenticatedSocket } from '../interfaces/socket.interface';

/**
 * Guard that validates JWT tokens on WebSocket events.
 * Extracts the token from handshake auth or authorization header.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
    private readonly logger = new Logger(WsJwtGuard.name);

    constructor(private readonly authService: AuthService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const client = context.switchToWs().getClient<AuthenticatedSocket>();

        // If user data is already attached (validated during handshake), allow
        if (client.data?.userId) {
            return true;
        }

        const token = this.extractToken(client);

        if (!token) {
            this.logger.warn('Connection rejected: no token provided');
            throw new WsException('Authentication required');
        }

        try {
            const payload = await this.authService.verifyToken(token);
            client.data = { userId: payload.userId, username: payload.username };
            return true;
        } catch {
            this.logger.warn('Connection rejected: invalid token');
            throw new WsException('Invalid or expired token');
        }
    }

    private extractToken(client: AuthenticatedSocket): string | null {
        // Priority 1: Socket.io auth object
        const authToken = client.handshake?.auth?.token;
        if (authToken) return authToken;

        // Priority 2: Authorization header
        const authHeader = client.handshake?.headers?.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.slice(7);
        }

        return null;
    }
}
