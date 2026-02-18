import { Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
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
 * Persistent state is stored in PostgreSQL via Prisma.
 */
@Injectable()
export class RoomService {
    private readonly logger = new Logger(RoomService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Create a new room and add the creator as the first member.
     */
    async createRoom(
        name: string,
        type: RoomType,
        creatorId: string,
    ): Promise<RoomData> {
        const dbType = type === 'private' ? 'PRIVATE' : 'GROUP';

        const room = await this.prisma.room.create({
            data: {
                name,
                type: dbType,
                creatorId,
                members: {
                    create: { userId: creatorId },
                },
            },
        });

        this.logger.log(`Room created: "${name}" (${room.id}) by ${creatorId}`);

        return {
            id: room.id,
            name: room.name,
            type,
            creatorId: room.creatorId,
            createdAt: room.createdAt.toISOString(),
        };
    }

    /**
     * Join a room. Enforces authorization for private rooms.
     */
    async joinRoom(
        client: AuthenticatedSocket,
        roomId: string,
        server: Server,
    ): Promise<void> {
        const room = await this.prisma.room.findUnique({
            where: { id: roomId },
        });

        if (!room) {
            throw new WsException('Room not found');
        }

        const userId = client.data.userId;

        // For private rooms, only invited users (already in members) can join
        if (room.type === 'PRIVATE') {
            const membership = await this.prisma.roomMember.findUnique({
                where: { userId_roomId: { userId, roomId } },
            });
            if (!membership) {
                throw new WsException('Not authorized to join this private room');
            }
        }

        // Upsert membership (idempotent join)
        await this.prisma.roomMember.upsert({
            where: { userId_roomId: { userId, roomId } },
            update: {},
            create: { userId, roomId },
        });

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

        await this.prisma.roomMember.deleteMany({
            where: { userId, roomId },
        });

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
        const members = await this.prisma.roomMember.findMany({
            where: { roomId },
            select: { userId: true },
        });
        return members.map((m) => m.userId);
    }

    /**
     * Get all rooms a user belongs to.
     */
    async getRoomsForUser(userId: string): Promise<RoomData[]> {
        const memberships = await this.prisma.roomMember.findMany({
            where: { userId },
            include: { room: true },
        });

        return memberships.map((m) => ({
            id: m.room.id,
            name: m.room.name,
            type: m.room.type === 'PRIVATE' ? 'private' as RoomType : 'group' as RoomType,
            creatorId: m.room.creatorId,
            createdAt: m.room.createdAt.toISOString(),
        }));
    }

    /**
     * Check if a user is a member of a room.
     */
    async isMember(roomId: string, userId: string): Promise<boolean> {
        const membership = await this.prisma.roomMember.findUnique({
            where: { userId_roomId: { userId, roomId } },
        });
        return !!membership;
    }

    /**
     * Re-join all rooms on reconnection.
     * Called during handleConnection to restore room subscriptions.
     */
    async rejoinRooms(client: AuthenticatedSocket): Promise<string[]> {
        const userId = client.data.userId;
        const memberships = await this.prisma.roomMember.findMany({
            where: { userId },
            select: { roomId: true },
        });

        const roomIds = memberships.map((m) => m.roomId);

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
        const room = await this.prisma.room.findUnique({
            where: { id: roomId },
        });

        if (!room) {
            throw new WsException('Room not found');
        }

        if (room.type !== 'PRIVATE') {
            throw new WsException('Can only invite to private rooms');
        }

        // Only existing members can invite
        const isInviterMember = await this.prisma.roomMember.findUnique({
            where: { userId_roomId: { userId: inviterId, roomId } },
        });

        if (!isInviterMember) {
            throw new WsException('Only room members can invite others');
        }

        await this.prisma.roomMember.upsert({
            where: { userId_roomId: { userId: inviteeId, roomId } },
            update: {},
            create: { userId: inviteeId, roomId },
        });

        this.logger.log(
            `User ${inviterId} invited ${inviteeId} to room ${roomId}`,
        );
    }
}
