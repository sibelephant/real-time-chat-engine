/**
 * Centralized WebSocket event names.
 * Eliminates magic strings across the codebase.
 */
export enum SocketEvent {
    // ── Chat ──────────────────────────────────────
    SendMessage = 'send_message',
    NewMessage = 'new_message',
    MessageAck = 'message_ack',
    GetMessageHistory = 'get_message_history',
    MessageHistory = 'message_history',

    // ── Room ──────────────────────────────────────
    CreateRoom = 'create_room',
    RoomCreated = 'room_created',
    JoinRoom = 'join_room',
    UserJoined = 'user_joined',
    LeaveRoom = 'leave_room',
    UserLeft = 'user_left',
    GetRooms = 'get_rooms',
    RoomsList = 'rooms_list',

    // ── Presence ──────────────────────────────────
    UserOnline = 'user_online',
    UserOffline = 'user_offline',
    GetOnlineUsers = 'get_online_users',
    OnlineUsers = 'online_users',

    // ── Typing ────────────────────────────────────
    Typing = 'typing',
    StopTyping = 'stop_typing',
    UserTyping = 'user_typing',
    UserStopTyping = 'user_stop_typing',

    // ── Error ─────────────────────────────────────
    Error = 'error',
}
