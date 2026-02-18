import { Controller, Get } from '@nestjs/common';
import { RedisService } from './redis/redis.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly redisService: RedisService,
    private readonly prismaService: PrismaService,
  ) { }

  /**
   * Health check endpoint for load balancers and monitoring.
   * Verifies Redis and PostgreSQL connectivity and returns server uptime.
   */
  @Get('health')
  async healthCheck() {
    let redisStatus = 'disconnected';
    let postgresStatus = 'disconnected';

    try {
      await this.redisService.ping();
      redisStatus = 'connected';
    } catch {
      redisStatus = 'disconnected';
    }

    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      postgresStatus = 'connected';
    } catch {
      postgresStatus = 'disconnected';
    }

    const allHealthy = redisStatus === 'connected' && postgresStatus === 'connected';

    return {
      status: allHealthy ? 'ok' : 'degraded',
      redis: redisStatus,
      postgres: postgresStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
