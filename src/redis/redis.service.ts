import {
    Injectable,
    Logger,
    OnModuleInit,
    OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Wraps an ioredis client and exposes typed Redis operations.
 * Connects on module init and disconnects on module destroy (graceful shutdown).
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    private client: Redis;

    constructor(private readonly configService: ConfigService) { }

    onModuleInit(): void {
        const host = this.configService.get<string>('REDIS_HOST', 'localhost');
        const port = this.configService.get<number>('REDIS_PORT', 6379);

        this.client = new Redis({ host, port, maxRetriesPerRequest: 3 });

        this.client.on('connect', () =>
            this.logger.log(`Connected to Redis at ${host}:${port}`),
        );

        this.client.on('error', (err) =>
            this.logger.error(`Redis error: ${err.message}`),
        );
    }

    async onModuleDestroy(): Promise<void> {
        this.logger.log('Disconnecting from Redis...');
        await this.client.quit();
    }

    /** Returns the underlying ioredis client (used by the Redis IO adapter). */
    getClient(): Redis {
        return this.client;
    }

    /** Check Redis connectivity. */
    async ping(): Promise<string> {
        return this.client.ping();
    }

    // ── String operations ───────────────────────────────────────

    async get(key: string): Promise<string | null> {
        return this.client.get(key);
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        if (ttlSeconds) {
            await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
            await this.client.set(key, value);
        }
    }

    async del(...keys: string[]): Promise<number> {
        return this.client.del(...keys);
    }

    // ── Hash operations ─────────────────────────────────────────

    async hset(key: string, field: string, value: string): Promise<number> {
        return this.client.hset(key, field, value);
    }

    async hmset(key: string, data: Record<string, string>): Promise<string> {
        return this.client.hmset(key, data);
    }

    async hget(key: string, field: string): Promise<string | null> {
        return this.client.hget(key, field);
    }

    async hgetall(key: string): Promise<Record<string, string>> {
        return this.client.hgetall(key);
    }

    async hdel(key: string, ...fields: string[]): Promise<number> {
        return this.client.hdel(key, ...fields);
    }

    // ── Set operations ──────────────────────────────────────────

    async sadd(key: string, ...members: string[]): Promise<number> {
        return this.client.sadd(key, ...members);
    }

    async srem(key: string, ...members: string[]): Promise<number> {
        return this.client.srem(key, ...members);
    }

    async smembers(key: string): Promise<string[]> {
        return this.client.smembers(key);
    }

    async sismember(key: string, member: string): Promise<number> {
        return this.client.sismember(key, member);
    }

    // ── List operations ─────────────────────────────────────────

    async lpush(key: string, ...values: string[]): Promise<number> {
        return this.client.lpush(key, ...values);
    }

    async lrange(key: string, start: number, stop: number): Promise<string[]> {
        return this.client.lrange(key, start, stop);
    }

    async ltrim(key: string, start: number, stop: number): Promise<string> {
        return this.client.ltrim(key, start, stop);
    }
}
