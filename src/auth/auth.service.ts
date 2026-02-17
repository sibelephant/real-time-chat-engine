import {
    Injectable,
    Logger,
    ConflictException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RedisService } from '../redis/redis.service';
import { v4 as uuidv4 } from 'uuid';

export interface JwtPayload {
    userId: string;
    username: string;
}

/**
 * Handles user registration, login, and JWT token operations.
 * User data is stored in Redis hashes for simplicity (no DB required).
 */
@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private static readonly BCRYPT_ROUNDS = 10;

    constructor(
        private readonly jwtService: JwtService,
        private readonly redisService: RedisService,
    ) { }

    /**
     * Register a new user with hashed password.
     * Returns a signed JWT on success.
     */
    async register(
        username: string,
        password: string,
    ): Promise<{ access_token: string }> {
        // Check if username already exists
        const existingUser = await this.redisService.get(`username:${username}`);
        if (existingUser) {
            throw new ConflictException('Username already taken');
        }

        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash(
            password,
            AuthService.BCRYPT_ROUNDS,
        );

        // Store user data in Redis hash
        await this.redisService.hmset(`user:${userId}`, {
            id: userId,
            username,
            password: hashedPassword,
        });

        // Map username → userId for lookup
        await this.redisService.set(`username:${username}`, userId);

        this.logger.log(`User registered: ${username} (${userId})`);

        const token = this.generateToken({ userId, username });
        return { access_token: token };
    }

    /**
     * Validate credentials and return a signed JWT.
     */
    async login(
        username: string,
        password: string,
    ): Promise<{ access_token: string }> {
        const userId = await this.redisService.get(`username:${username}`);
        if (!userId) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const user = await this.redisService.hgetall(`user:${userId}`);
        if (!user || !user.password) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        this.logger.log(`User logged in: ${username}`);

        const token = this.generateToken({ userId, username });
        return { access_token: token };
    }

    /**
     * Verify a JWT token and return the decoded payload.
     */
    async verifyToken(token: string): Promise<JwtPayload> {
        try {
            return this.jwtService.verify<JwtPayload>(token);
        } catch {
            throw new UnauthorizedException('Invalid or expired token');
        }
    }

    private generateToken(payload: JwtPayload): string {
        return this.jwtService.sign(payload);
    }
}
