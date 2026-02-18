import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * Wraps PrismaClient using composition (Prisma v7 pattern).
 * Uses @prisma/adapter-pg driver adapter for PostgreSQL connectivity.
 * Connects on module init and disconnects gracefully on destroy.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);
    private readonly pool: Pool;
    private readonly client: InstanceType<typeof PrismaClient>;

    constructor(private readonly configService: ConfigService) {
        const connectionString = this.configService.get<string>('DATABASE_URL');
        this.pool = new Pool({ connectionString });
        const adapter = new PrismaPg(this.pool);

        this.client = new PrismaClient({ adapter });
    }

    // ── Lifecycle hooks ─────────────────────────────────────────

    async onModuleInit(): Promise<void> {
        await this.client.$connect();
        this.logger.log('Connected to PostgreSQL');
    }

    async onModuleDestroy(): Promise<void> {
        this.logger.log('Disconnecting from PostgreSQL...');
        await this.client.$disconnect();
        await this.pool.end();
    }

    // ── Model accessors ─────────────────────────────────────────

    get user() {
        return this.client.user;
    }

    get room() {
        return this.client.room;
    }

    get roomMember() {
        return this.client.roomMember;
    }

    get message() {
        return this.client.message;
    }

    // ── Raw query support (used by health check) ────────────────

    async $queryRaw<T = unknown>(
        query: TemplateStringsArray,
        ...values: any[]
    ): Promise<T> {
        return this.client.$queryRaw<T>(query, ...values);
    }

    async $transaction<T>(
        fn: (prisma: Omit<InstanceType<typeof PrismaClient>, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>) => Promise<T>,
    ): Promise<T> {
        return this.client.$transaction(fn);
    }
}
