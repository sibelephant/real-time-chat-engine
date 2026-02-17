import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { RedisService } from '../redis/redis.service';
import { AuthenticatedSocket } from '../common/interfaces/socket.interface';
import { SocketEvent } from '../common/enums/events.enum';

/**
 * Tracks user online/offline status and typing indicators.
 * Uses Redis sets for cross-instance visibility.
 */
@Injectable()
export class PresenceService {
    private readonly logger = new Logger(PresenceService.name);

    constructor(private readonly redisService: RedisService) { }

    /**
     * Register a user as online.
     * Maps socketId → userId for disconnect cleanup.
     * Prevents duplicate `user_online` broadcasts for multi-tab sessions.
     */
    async handleConnection(
        client: AuthenticatedSocket,
        server: Server,
    ): Promise<void> {
        const { userId, username } = client.data;

        // Track socketId → userId mapping (for disconnect cleanup)
        await this.redisService.set(`socket:${client.id}`, userId);

        // Track userId → socketId(s) for multi-tab awareness
        await this.redisService.sadd(`user:${userId}:sockets`, client.id);

        // Check if user was already online (multi-tab scenario)
        const existingSockets = await this.redisService.smembers(
            `user:${userId}:sockets`,
        );

        if (existingSockets.length === 1) {
            // First tab — mark as online and broadcast
            await this.redisService.sadd('online_users', userId);
            await this.redisService.hset('online_users_map', userId, username);

            server.emit(SocketEvent.UserOnline, {
                userId,
                username,
                timestamp: new Date().toISOString(),
            });

            this.logger.log(`User online: ${username} (${userId})`);
        } else {
            this.logger.log(
                `User ${username} opened additional tab (${existingSockets.length} total)`,
            );
        }
    }

    /**
     * Remove a user's socket from tracking.
     * Only broadcasts `user_offline` when the last socket disconnects.
     */
    async handleDisconnect(
        client: AuthenticatedSocket,
        server: Server,
    ): Promise<void> {
        const userId = await this.redisService.get(`socket:${client.id}`);
        if (!userId) return;

        // Clean up this socket
        await this.redisService.del(`socket:${client.id}`);
        await this.redisService.srem(`user:${userId}:sockets`, client.id);

        // Check remaining sockets for this user
        const remainingSockets = await this.redisService.smembers(
            `user:${userId}:sockets`,
        );

        if (remainingSockets.length === 0) {
            // Last tab closed — mark as offline
            await this.redisService.srem('online_users', userId);
            await this.redisService.hdel('online_users_map', userId);

            const username = client.data?.username ?? 'unknown';

            server.emit(SocketEvent.UserOffline, {
                userId,
                username,
                timestamp: new Date().toISOString(),
            });

            this.logger.log(`User offline: ${username} (${userId})`);
        }
    }

    /**
     * Get the list of currently online users.
     */
    async getOnlineUsers(): Promise<Record<string, string>> {
        return this.redisService.hgetall('online_users_map');
    }

    /**
     * Broadcast typing indicator to a room (excluding sender).
     */
    setTyping(client: AuthenticatedSocket, roomId: string): void {
        client.to(roomId).emit(SocketEvent.UserTyping, {
            roomId,
            userId: client.data.userId,
            username: client.data.username,
        });
    }

    /**
     * Clear typing indicator for a room (excluding sender).
     */
    clearTyping(client: AuthenticatedSocket, roomId: string): void {
        client.to(roomId).emit(SocketEvent.UserStopTyping, {
            roomId,
            userId: client.data.userId,
            username: client.data.username,
        });
    }
}
