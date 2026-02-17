# 🚀 Real-Time Chat Engine

A horizontally scalable real-time messaging server built with **NestJS**, **Socket.io**, and **Redis**. Designed for production-grade bi-directional communication with room management, user presence tracking, and multi-instance support via Redis pub/sub.

## Architecture

```
┌──────────┐      ┌──────────────┐      ┌───────────┐
│  Client  │◄────►│  Nginx (LB)  │◄────►│  App (×N) │
│ Socket.io│      │  sticky sess │      │  NestJS   │
└──────────┘      └──────────────┘      └─────┬─────┘
                                              │
                                        ┌─────▼─────┐
                                        │   Redis    │
                                        │ pub/sub +  │
                                        │  storage   │
                                        └───────────┘
```

- **Nginx** load balances with `ip_hash` for Socket.io sticky sessions
- **Redis** provides pub/sub for cross-instance broadcasting and data storage
- **Docker Compose** runs 2 app instances + Redis + Nginx out of the box

## Features

| Feature | Description |
|---|---|
| **JWT Authentication** | Register/login with bcrypt-hashed passwords, JWT for REST + WS |
| **Room Management** | Create, join, leave rooms (private & group), room invites |
| **Real-Time Messaging** | Send messages to rooms, message history (Redis-backed, capped at 100) |
| **Presence Tracking** | Online/offline status with multi-tab awareness |
| **Typing Indicators** | Real-time typing/stop-typing broadcasts per room |
| **Rate Limiting** | Sliding-window rate limiter on WS events (configurable) |
| **Input Sanitization** | HTML/XSS sanitization on all user inputs |
| **Reconnection Support** | Auto re-joins rooms on reconnect |
| **Horizontal Scaling** | Redis IO adapter + Nginx sticky sessions |
| **Graceful Shutdown** | Clean SIGTERM/SIGINT handling |
| **Health Check** | `/health` endpoint with Redis connectivity status |

## Quick Start

### Local Development

```bash
# Prerequisites: Node.js 20+, Redis running on localhost:6379

npm install
cp .env.example .env    # Configure env variables
npm run start:dev       # Starts with hot-reload
```

### Docker Compose (2 instances)

```bash
docker compose up --build
# App available at http://localhost:80
# Health check: http://localhost:80/health
```

## REST API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Register a new user |
| `POST` | `/auth/login` | Login, returns JWT |
| `GET` | `/health` | Health check with Redis status |

### Register

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "secret123"}'
```

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "secret123"}'
```

## Socket.io Events

Connect with the JWT token:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: 'your-jwt-token' }
});
```

### Client → Server

| Event | Payload | Response |
|---|---|---|
| `send_message` | `{ roomId, content }` | `message_ack` with `{ messageId, timestamp }` |
| `get_message_history` | `{ roomId, limit?, offset? }` | `message_history` |
| `create_room` | `{ name, type: 'private'\|'group' }` | `room_created` |
| `join_room` | `{ roomId }` | `user_joined` |
| `leave_room` | `{ roomId }` | `user_left` |
| `get_rooms` | — | `rooms_list` |
| `get_online_users` | — | `online_users` |
| `typing` | `{ roomId }` | Broadcasts `user_typing` to room |
| `stop_typing` | `{ roomId }` | Broadcasts `user_stop_typing` to room |

### Server → Client (Broadcasts)

| Event | Description |
|---|---|
| `new_message` | New message in a room |
| `user_joined` | User joined a room |
| `user_left` | User left a room |
| `user_online` | User came online |
| `user_offline` | User went offline |
| `user_typing` | User is typing in a room |
| `user_stop_typing` | User stopped typing |
| `error` | Error with `{ message, timestamp }` |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP/WS server port |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_SECRET` | `dev-secret-...` | JWT signing secret |
| `JWT_EXPIRATION` | `24h` | JWT token TTL |
| `RATE_LIMIT_TTL` | `60` | Rate limit window (seconds) |
| `RATE_LIMIT_MAX` | `30` | Max events per window |

## Project Structure

```
src/
├── auth/               # JWT authentication (register, login, verify)
│   ├── dto/            # RegisterDto, LoginDto
│   ├── auth.controller.ts
│   ├── auth.module.ts
│   └── auth.service.ts
├── chat/               # WebSocket gateway & messaging
│   ├── dto/            # SendMessageDto
│   ├── chat.gateway.ts # All WS event handlers
│   ├── chat.module.ts
│   └── chat.service.ts
├── room/               # Room lifecycle & membership
│   ├── dto/            # CreateRoomDto, JoinRoomDto
│   ├── room.module.ts
│   └── room.service.ts
├── presence/           # Online/offline & typing indicators
│   ├── presence.module.ts
│   └── presence.service.ts
├── redis/              # ioredis wrapper service
│   ├── redis.module.ts
│   └── redis.service.ts
├── common/
│   ├── enums/          # SocketEvent enum
│   ├── filters/        # WsExceptionFilter
│   ├── guards/         # WsJwtGuard
│   ├── interceptors/   # WsRateLimitInterceptor
│   ├── interfaces/     # AuthenticatedSocket
│   └── pipes/          # SanitizePipe
├── redis-io.adapter.ts # Redis pub/sub adapter for Socket.io
├── app.module.ts
├── app.controller.ts   # Health check
└── main.ts             # Bootstrap with graceful shutdown
```

## Tech Stack

- **NestJS 11** — Framework
- **Socket.io** — WebSocket transport
- **ioredis** — Redis client
- **@socket.io/redis-adapter** — Cross-instance pub/sub
- **@nestjs/jwt + bcrypt** — Authentication
- **class-validator** — DTO validation
- **Docker + Nginx** — Horizontal scaling

## License

MIT
