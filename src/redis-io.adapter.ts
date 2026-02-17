import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

/**
 * Custom Socket.io adapter that uses Redis pub/sub for
 * cross-instance event broadcasting (horizontal scaling).
 */
export class RedisIoAdapter extends IoAdapter {
    private readonly logger = new Logger(RedisIoAdapter.name);
    private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
    private pubClient: Redis | null = null;
    private subClient: Redis | null = null;

    constructor(
        app: INestApplicationContext,
        private readonly configService: ConfigService,
    ) {
        super(app);
    }

    /**
     * Initialize Redis pub/sub clients and create the adapter.
     * Must be called before server starts listening.
     */
    async connectToRedis(): Promise<void> {
        const host = this.configService.get<string>('REDIS_HOST', 'localhost');
        const port = this.configService.get<number>('REDIS_PORT', 6379);

        this.pubClient = new Redis({ host, port });
        this.subClient = this.pubClient.duplicate();

        await Promise.all([
            new Promise<void>((resolve) => this.pubClient!.on('connect', resolve)),
            new Promise<void>((resolve) => this.subClient!.on('connect', resolve)),
        ]);

        this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
        this.logger.log(`Redis IO Adapter connected to ${host}:${port}`);
    }

    createIOServer(port: number, options?: ServerOptions): any {
        const server = super.createIOServer(port, options);

        if (this.adapterConstructor) {
            server.adapter(this.adapterConstructor);
        }

        return server;
    }

    /**
     * Disconnect Redis clients on shutdown.
     */
    async close(): Promise<void> {
        this.logger.log('Closing Redis IO Adapter connections...');

        await Promise.all([
            this.pubClient?.quit(),
            this.subClient?.quit(),
        ]);
    }
}
