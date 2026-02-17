import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis-io.adapter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

  // ── Config validation ───────────────────────────────────────
  const configService = app.get(ConfigService);
  const jwtSecret = configService.get<string>('JWT_SECRET');
  if (!jwtSecret || jwtSecret === 'your-secret-key-change-in-production') {
    logger.warn(
      'JWT_SECRET is using default value. Set a strong secret in production!',
    );
  }

  // ── Global validation pipe ──────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // ── CORS ────────────────────────────────────────────────────
  app.enableCors({ origin: '*', credentials: true });

  // ── Redis IO adapter for Socket.io horizontal scaling ───────
  const redisIoAdapter = new RedisIoAdapter(app, configService);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // ── Graceful shutdown ───────────────────────────────────────
  app.enableShutdownHooks();

  process.on('SIGTERM', async () => {
    logger.log('SIGTERM received. Shutting down gracefully...');
    await redisIoAdapter.close();
    await app.close();
  });

  process.on('SIGINT', async () => {
    logger.log('SIGINT received. Shutting down gracefully...');
    await redisIoAdapter.close();
    await app.close();
  });

  // ── Start server ────────────────────────────────────────────
  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`🚀 Server running on http://localhost:${port}`);
  logger.log(`📡 WebSocket gateway ready`);
  logger.log(`❤️  Health check: http://localhost:${port}/health`);
}

bootstrap();
