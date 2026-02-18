import {
    Injectable,
    Logger,
    ConflictException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
    userId: string;
    username: string;
}

/**
 * Handles user registration, login, and JWT token operations.
 * User data is stored in PostgreSQL via Prisma.
 */
@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private static readonly BCRYPT_ROUNDS = 10;

    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
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
        const existingUser = await this.prisma.user.findUnique({
            where: { username },
        });

        if (existingUser) {
            throw new ConflictException('Username already taken');
        }

        const hashedPassword = await bcrypt.hash(
            password,
            AuthService.BCRYPT_ROUNDS,
        );

        const user = await this.prisma.user.create({
            data: {
                username,
                password: hashedPassword,
            },
        });

        this.logger.log(`User registered: ${username} (${user.id})`);

        const token = this.generateToken({ userId: user.id, username });
        return { access_token: token };
    }

    /**
     * Validate credentials and return a signed JWT.
     */
    async login(
        username: string,
        password: string,
    ): Promise<{ access_token: string }> {
        const user = await this.prisma.user.findUnique({
            where: { username },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        this.logger.log(`User logged in: ${username}`);

        const token = this.generateToken({ userId: user.id, username });
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
