import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
    WsException,
} from '@nestjs/websockets';
import { Logger, UseFilters, UseGuards, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../common/interfaces/socket.interface';
import { SocketEvent } from '../common/enums/events.enum';
import { WsExceptionFilter } from '../common/filters/ws-exception.filter';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';
import { WsRateLimitInterceptor } from '../common/interceptors/ws-rate-limit.interceptor';
import { SanitizePipe } from '../common/pipes/sanitize.pipe';
import { AuthService } from '../auth/auth.service';
import { ChatService } from './chat.service';
import { RoomService } from '../room/room.service';
import { PresenceService } from '../presence/presence.service';
import { SendMessageDto } from './dto/message.dto';
import { CreateRoomDto } from '../room/dto/create-room.dto';
import { JoinRoomDto } from '../room/dto/join-room.dto';

@WebSocketGateway({
    cors: {
        origin: '*',
        credentials: true,
    },
})
@UseFilters(WsExceptionFilter)
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(ChatGateway.name);

    constructor(
        private readonly authService: AuthService,
        private readonly chatService: ChatService,
        private readonly roomService: RoomService,
        private readonly presenceService: PresenceService,
    ) { }

    // ── Connection Lifecycle ─────────────────────────────────────

    /**
     * Validates JWT on connection, rejects unauthenticated sockets.
     * Re-joins rooms and broadcasts presence on success.
     */
    async handleConnection(client: AuthenticatedSocket): Promise<void> {
        try {
            const token =
                client.handshake?.auth?.token ||
                client.handshake?.headers?.authorization?.replace('Bearer ', '');

            if (!token) {
                this.logger.warn(`Connection rejected: no token (${client.id})`);
                client.emit(SocketEvent.Error, { message: 'Authentication required' });
                client.disconnect();
                return;
            }

            const payload = await this.authService.verifyToken(token);
            client.data = { userId: payload.userId, username: payload.username };

            // Re-join previously subscribed rooms (reconnection support)
            await this.roomService.rejoinRooms(client);

            // Track presence
            await this.presenceService.handleConnection(client, this.server);

            this.logger.log(
                `Client connected: ${payload.username} (${client.id})`,
            );
        } catch {
            this.logger.warn(`Connection rejected: invalid token (${client.id})`);
            client.emit(SocketEvent.Error, { message: 'Invalid token' });
            client.disconnect();
        }
    }

    /**
     * Clean up presence and log disconnection.
     */
    async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
        if (client.data?.userId) {
            await this.presenceService.handleDisconnect(client, this.server);
            this.logger.log(
                `Client disconnected: ${client.data.username} (${client.id})`,
            );
        }
    }

    // ── Chat Events ──────────────────────────────────────────────

    @UseGuards(WsJwtGuard)
    @UseInterceptors(WsRateLimitInterceptor)
    @UsePipes(new SanitizePipe(), new ValidationPipe({ whitelist: true, transform: true }))
    @SubscribeMessage(SocketEvent.SendMessage)
    async handleSendMessage(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() payload: SendMessageDto,
    ) {
        const ack = await this.chatService.sendMessage(
            this.server,
            client,
            payload.roomId,
            payload.content,
        );

        return { event: SocketEvent.MessageAck, data: ack };
    }

    @UseGuards(WsJwtGuard)
    @SubscribeMessage(SocketEvent.GetMessageHistory)
    async handleGetMessageHistory(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() payload: { roomId: string; limit?: number; offset?: number },
    ) {
        const isMember = await this.roomService.isMember(
            payload.roomId,
            client.data.userId,
        );
        if (!isMember) {
            throw new WsException('Not a member of this room');
        }

        const messages = await this.chatService.getMessageHistory(
            payload.roomId,
            payload.limit,
            payload.offset,
        );

        return { event: SocketEvent.MessageHistory, data: messages };
    }

    // ── Room Events ──────────────────────────────────────────────

    @UseGuards(WsJwtGuard)
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    @SubscribeMessage(SocketEvent.CreateRoom)
    async handleCreateRoom(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() payload: CreateRoomDto,
    ) {
        const room = await this.roomService.createRoom(
            payload.name,
            payload.type,
            client.data.userId,
        );

        // Auto-join the creator to the Socket.io room
        client.join(room.id);

        return { event: SocketEvent.RoomCreated, data: room };
    }

    @UseGuards(WsJwtGuard)
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    @SubscribeMessage(SocketEvent.JoinRoom)
    async handleJoinRoom(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() payload: JoinRoomDto,
    ) {
        await this.roomService.joinRoom(client, payload.roomId, this.server);
        return { event: SocketEvent.UserJoined, data: { roomId: payload.roomId } };
    }

    @UseGuards(WsJwtGuard)
    @SubscribeMessage(SocketEvent.LeaveRoom)
    async handleLeaveRoom(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() payload: JoinRoomDto,
    ) {
        await this.roomService.leaveRoom(client, payload.roomId, this.server);
        return { event: SocketEvent.UserLeft, data: { roomId: payload.roomId } };
    }

    @UseGuards(WsJwtGuard)
    @SubscribeMessage(SocketEvent.GetRooms)
    async handleGetRooms(@ConnectedSocket() client: AuthenticatedSocket) {
        const rooms = await this.roomService.getRoomsForUser(client.data.userId);
        return { event: SocketEvent.RoomsList, data: rooms };
    }

    // ── Presence Events ──────────────────────────────────────────

    @UseGuards(WsJwtGuard)
    @SubscribeMessage(SocketEvent.GetOnlineUsers)
    async handleGetOnlineUsers() {
        const users = await this.presenceService.getOnlineUsers();
        return { event: SocketEvent.OnlineUsers, data: users };
    }

    @UseGuards(WsJwtGuard)
    @SubscribeMessage(SocketEvent.Typing)
    handleTyping(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() payload: { roomId: string },
    ) {
        this.presenceService.setTyping(client, payload.roomId);
    }

    @UseGuards(WsJwtGuard)
    @SubscribeMessage(SocketEvent.StopTyping)
    handleStopTyping(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() payload: { roomId: string },
    ) {
        this.presenceService.clearTyping(client, payload.roomId);
    }
}
