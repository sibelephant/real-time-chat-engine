import { Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
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
 */
@Injectable()
export class ChatService {
    private readonly logger = new Logger(ChatService.name);
    private static readonly MAX_HISTORY = 100;

    constructor(
        private readonly redisService: RedisService,
        private readonly roomService: RoomService,
    ) { }

    /**
     * Send a message to a room.
     * Validates membership, stores in Redis, broadcasts to room, and returns ack.
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

        const message: StoredMessage = {
            id: uuidv4(),
            roomId,
            userId,
            username,
            content,
            timestamp: new Date().toISOString(),
        };

        // Store message in Redis list (capped)
        await this.redisService.lpush(
            `room:${roomId}:messages`,
            JSON.stringify(message),
        );
        await this.redisService.ltrim(
            `room:${roomId}:messages`,
            0,
            ChatService.MAX_HISTORY - 1,
        );

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
     */
    async getMessageHistory(
        roomId: string,
        limit = 50,
        offset = 0,
    ): Promise<StoredMessage[]> {
        const raw = await this.redisService.lrange(
            `room:${roomId}:messages`,
            offset,
            offset + limit - 1,
        );

        return raw.map((entry) => JSON.parse(entry) as StoredMessage);
    }
}
