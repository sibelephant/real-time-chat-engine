import { Socket } from 'socket.io';

/**
 * Authenticated socket with user data attached after JWT validation.
 */
export interface AuthenticatedSocket extends Socket {
    data: {
        userId: string;
        username: string;
    };
}
