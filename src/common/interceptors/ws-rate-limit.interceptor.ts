import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Observable } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedSocket } from '../interfaces/socket.interface';

/**
 * Rate limiter for WebSocket events.
 * Uses an in-memory sliding window per userId.
 * Configurable via RATE_LIMIT_TTL (seconds) and RATE_LIMIT_MAX (max events).
 */
@Injectable()
export class WsRateLimitInterceptor implements NestInterceptor {
    private readonly logger = new Logger(WsRateLimitInterceptor.name);
    private readonly hitMap = new Map<string, number[]>();
    private readonly ttl: number;
    private readonly max: number;

    constructor(private readonly configService: ConfigService) {
        this.ttl = this.configService.get<number>('RATE_LIMIT_TTL', 60) * 1000;
        this.max = this.configService.get<number>('RATE_LIMIT_MAX', 30);
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const client = context.switchToWs().getClient<AuthenticatedSocket>();
        const userId = client.data?.userId;

        if (!userId) {
            throw new WsException('Authentication required');
        }

        const now = Date.now();
        const timestamps = this.hitMap.get(userId) ?? [];

        // Remove expired timestamps outside the window
        const validTimestamps = timestamps.filter((ts) => now - ts < this.ttl);
        validTimestamps.push(now);
        this.hitMap.set(userId, validTimestamps);

        if (validTimestamps.length > this.max) {
            this.logger.warn(`Rate limit exceeded for user ${userId}`);
            throw new WsException(
                `Rate limit exceeded. Max ${this.max} events per ${this.ttl / 1000}s.`,
            );
        }

        return next.handle();
    }
}
