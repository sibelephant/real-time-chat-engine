import {
    Catch,
    ArgumentsHost,
    Logger,
    HttpException,
} from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { SocketEvent } from '../enums/events.enum';

/**
 * Catches WebSocket exceptions and emits structured error events to the client.
 */
@Catch(WsException, HttpException)
export class WsExceptionFilter extends BaseWsExceptionFilter {
    private readonly logger = new Logger(WsExceptionFilter.name);

    catch(exception: WsException | HttpException, host: ArgumentsHost): void {
        const client = host.switchToWs().getClient();
        const message =
            exception instanceof WsException
                ? exception.getError()
                : exception.getResponse();

        const errorPayload = {
            event: SocketEvent.Error,
            data: {
                message: typeof message === 'string' ? message : (message as any)?.message ?? 'Unknown error',
                timestamp: new Date().toISOString(),
            },
        };

        this.logger.error(
            `WS Error [${client.data?.userId ?? 'unknown'}]: ${errorPayload.data.message}`,
        );

        client.emit(SocketEvent.Error, errorPayload.data);
    }
}
