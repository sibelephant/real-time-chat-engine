import { Controller, Get } from '@nestjs/common';
import { RedisService } from './redis/redis.service';

@Controller()
export class AppController {
  constructor(private readonly redisService: RedisService) { }

  /**
   * Health check endpoint for load balancers and monitoring.
   * Verifies Redis connectivity and returns server uptime.
   */
  @Get('health')
  async healthCheck() {
    let redisStatus = 'disconnected';

    try {
      await this.redisService.ping();
      redisStatus = 'connected';
    } catch {
      redisStatus = 'disconnected';
    }

    return {
      status: redisStatus === 'connected' ? 'ok' : 'degraded',
      redis: redisStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
