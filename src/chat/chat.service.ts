import { Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RoomService } from '../room/room.service';
import { AuthenticatedSocket } from '../common/interfaces/socket.interface';
import { SocketEvent } from '../common/enums/events.enum';

export interface StoredMessage {
    id: string;
    roomId: string;
    userId: string;
    username: string;
    content: string;
    timestamp: string;
}

/**
 * Handles message sending, validation, storage, and history retrieval.
 *
 * Dual-write strategy:
 *  - PostgreSQL: persistent message archive (source of truth)
 *  - Redis: cached last N messages per room for fast loading
 */
@Injectable()
export class ChatService {
    private readonly logger = new Logger(ChatService.name);
    private static readonly CACHE_SIZE = 50;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
        private readonly roomService: RoomService,
    ) { }

    /**
     * Send a message to a room.
     * Validates membership, stores in PostgreSQL + Redis cache,
     * broadcasts to room, and returns ack.
     */
    async sendMessage(
        server: Server,
        client: AuthenticatedSocket,
        roomId: string,
        content: string,
    ): Promise<{ messageId: string; timestamp: string }> {
        const { userId, username } = client.data;

        // Authorization: check room membership
        const isMember = await this.roomService.isMember(roomId, userId);
        if (!isMember) {
            throw new WsException('Not a member of this room');
        }

        // Persist to PostgreSQL (source of truth)
        const dbMessage = await this.prisma.message.create({
            data: {
                content,
                userId,
                roomId,
            },
        });

        const message: StoredMessage = {
            id: dbMessage.id,
            roomId,
            userId,
            username,
            content,
            timestamp: dbMessage.createdAt.toISOString(),
        };

        // Cache in Redis for fast recent-message loading
        try {
            await this.redisService.lpush(
                `room:${roomId}:messages`,
                JSON.stringify(message),
            );
            await this.redisService.ltrim(
                `room:${roomId}:messages`,
                0,
                ChatService.CACHE_SIZE - 1,
            );
        } catch (error) {
            // Redis cache failure should not block message delivery
            this.logger.warn(`Redis cache write failed for room ${roomId}: ${error}`);
        }

        // Broadcast to all room members
        server.to(roomId).emit(SocketEvent.NewMessage, message);

        this.logger.log(
            `Message in room ${roomId} from ${username}: ${content.substring(0, 50)}...`,
        );

        // Return ack to sender
        return { messageId: message.id, timestamp: message.timestamp };
    }

    /**
     * Get paginated message history for a room.
     * Tries Redis cache first, falls back to PostgreSQL on cache miss.
     */
    async getMessageHistory(
        roomId: string,
        limit = 50,
        offset = 0,
    ): Promise<StoredMessage[]> {
        // Try Redis cache first (only works for recent messages with offset 0)
        if (offset === 0) {
            try {
                const cached = await this.redisService.lrange(
                    `room:${roomId}:messages`,
                    0,
                    limit - 1,
                );

                if (cached.length > 0) {
                    this.logger.debug(`Cache hit for room ${roomId} (${cached.length} messages)`);
                    return cached.map((entry) => JSON.parse(entry) as StoredMessage);
                }
            } catch (error) {
                this.logger.warn(`Redis cache read failed for room ${roomId}: ${error}`);
            }
        }

        // Fall back to PostgreSQL
        const dbMessages = await this.prisma.message.findMany({
            where: { roomId },
            orderBy: { createdAt: 'desc' },
            skip: offset,
            take: limit,
            include: { user: { select: { username: true } } },
        });

        return dbMessages.map((msg) => ({
            id: msg.id,
            roomId: msg.roomId,
            userId: msg.userId,
            username: msg.user.username,
            content: msg.content,
            timestamp: msg.createdAt.toISOString(),
        }));
    }
}
