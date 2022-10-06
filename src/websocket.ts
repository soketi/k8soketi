import { App } from './app-managers/app';
import { PresenceMember, User } from './handlers/pusherWebsocketsHandler';
import { WebSocket as BaseWebSocket } from 'uWebSockets.js';

export interface WebSocket extends BaseWebSocket {
    id?: string;
    subscribedChannels?: Set<string>;
    presence?: Map<string, PresenceMember>;
    pingTimeout?: NodeJS.Timeout;
    userAuthenticationTimeout?: NodeJS.Timeout;
    ip?: string;
    ip2?: string;
    appKey?: string;
    app?: App;
    user?: User;

    sendJson?(data: { [key: string]: any; }): Promise<void>;
    sendJsonAndClose?(data: { [key: string]: any; }, code: number): Promise<void>;
    updatePingTimeout(): Promise<void>;
    clearPingTimeout(): Promise<void>;
    clearUserAuthenticationTimeout(): Promise<void>;
}
