import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoomModule } from '../room/room.module';
import { PresenceModule } from '../presence/presence.module';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { WsRateLimitInterceptor } from '../common/interceptors/ws-rate-limit.interceptor';

@Module({
    imports: [AuthModule, RoomModule, PresenceModule],
    providers: [ChatGateway, ChatService, WsRateLimitInterceptor],
})
export class ChatModule { }
