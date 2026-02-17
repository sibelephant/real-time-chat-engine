import { Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '../redis/redis.service';
import { AuthenticatedSocket } from '../common/interfaces/socket.interface';
import { SocketEvent } from '../common/enums/events.enum';

export type RoomType = 'private' | 'group';

export interface RoomData {
    id: string;
    name: string;
    type: RoomType;
    creatorId: string;
    createdAt: string;
}

/**
 * Manages room lifecycle: creation, membership, authorization, and reconnection re-joins.
 * All state is stored in Redis for horizontal scaling compatibility.
 */
@Injectable()
export class RoomService {
    private readonly logger = new Logger(RoomService.name);

    constructor(private readonly redisService: RedisService) { }

    /**
     * Create a new room and add the creator as the first member.
     */
    async createRoom(
        name: string,
        type: RoomType,
        creatorId: string,
    ): Promise<RoomData> {
        const roomId = uuidv4();
        const roomData: RoomData = {
            id: roomId,
            name,
            type,
            creatorId,
            createdAt: new Date().toISOString(),
        };

        // Store room metadata
        await this.redisService.hmset(`room:${roomId}`, roomData as any);

        // Add creator as member
        await this.redisService.sadd(`room:${roomId}:members`, creatorId);

        // Track room in user's room list
        await this.redisService.sadd(`user:${creatorId}:rooms`, roomId);

        // Track room in global rooms list
        await this.redisService.sadd('rooms', roomId);

        this.logger.log(`Room created: "${name}" (${roomId}) by ${creatorId}`);
        return roomData;
    }

    /**
     * Join a room. Enforces authorization for private rooms.
     */
    async joinRoom(
        client: AuthenticatedSocket,
        roomId: string,
        server: Server,
    ): Promise<void> {
        const room = await this.redisService.hgetall(`room:${roomId}`);
        if (!room || !room.id) {
            throw new WsException('Room not found');
        }

        const userId = client.data.userId;

        // For private rooms, only invited users (already in members set) can join
        if (room.type === 'private') {
            const isMember = await this.redisService.sismember(
                `room:${roomId}:members`,
                userId,
            );
            if (!isMember) {
                throw new WsException('Not authorized to join this private room');
            }
        }

        // Add to members set and user's room list
        await this.redisService.sadd(`room:${roomId}:members`, userId);
        await this.redisService.sadd(`user:${userId}:rooms`, roomId);

        // Join the Socket.io room
        client.join(roomId);

        this.logger.log(
            `User ${client.data.username} joined room "${room.name}" (${roomId})`,
        );

        // Broadcast to room members
        server.to(roomId).emit(SocketEvent.UserJoined, {
            roomId,
            userId,
            username: client.data.username,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Leave a room and notify remaining members.
     */
    async leaveRoom(
        client: AuthenticatedSocket,
        roomId: string,
        server: Server,
    ): Promise<void> {
        const userId = client.data.userId;

        await this.redisService.srem(`room:${roomId}:members`, userId);
        await this.redisService.srem(`user:${userId}:rooms`, roomId);

        client.leave(roomId);

        this.logger.log(
            `User ${client.data.username} left room ${roomId}`,
        );

        server.to(roomId).emit(SocketEvent.UserLeft, {
            roomId,
            userId,
            username: client.data.username,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Get all members of a room.
     */
    async getRoomMembers(roomId: string): Promise<string[]> {
        return this.redisService.smembers(`room:${roomId}:members`);
    }

    /**
     * Get all rooms a user belongs to.
     */
    async getRoomsForUser(userId: string): Promise<RoomData[]> {
        const roomIds = await this.redisService.smembers(`user:${userId}:rooms`);
        const rooms: RoomData[] = [];

        for (const roomId of roomIds) {
            const room = await this.redisService.hgetall(`room:${roomId}`);
            if (room && room.id) {
                rooms.push(room as unknown as RoomData);
            }
        }

        return rooms;
    }

    /**
     * Check if a user is a member of a room.
     */
    async isMember(roomId: string, userId: string): Promise<boolean> {
        const result = await this.redisService.sismember(
            `room:${roomId}:members`,
            userId,
        );
        return result === 1;
    }

    /**
     * Re-join all rooms on reconnection.
     * Called during handleConnection to restore room subscriptions.
     */
    async rejoinRooms(client: AuthenticatedSocket): Promise<string[]> {
        const userId = client.data.userId;
        const roomIds = await this.redisService.smembers(`user:${userId}:rooms`);

        for (const roomId of roomIds) {
            client.join(roomId);
        }

        if (roomIds.length > 0) {
            this.logger.log(
                `User ${client.data.username} re-joined ${roomIds.length} room(s)`,
            );
        }

        return roomIds;
    }

    /**
     * Invite a user to a private room (adds them to the member set).
     */
    async inviteToRoom(
        roomId: string,
        inviterId: string,
        inviteeId: string,
    ): Promise<void> {
        const room = await this.redisService.hgetall(`room:${roomId}`);
        if (!room || !room.id) {
            throw new WsException('Room not found');
        }

        if (room.type !== 'private') {
            throw new WsException('Can only invite to private rooms');
        }

        // Only room creator or existing members can invite
        const isInviterMember = await this.redisService.sismember(
            `room:${roomId}:members`,
            inviterId,
        );
        if (!isInviterMember) {
            throw new WsException('Only room members can invite others');
        }

        await this.redisService.sadd(`room:${roomId}:members`, inviteeId);
        await this.redisService.sadd(`user:${inviteeId}:rooms`, roomId);

        this.logger.log(
            `User ${inviterId} invited ${inviteeId} to room ${roomId}`,
        );
    }
}
