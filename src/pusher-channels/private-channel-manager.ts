import { App } from '../app-managers/app';
import { JoinResponse, PublicChannelManager } from './public-channel-manager';
import Pusher from 'pusher';
import { PusherMessage } from '../message';
import { WebSocket } from './../websocket';

export class PrivateChannelManager extends PublicChannelManager {
    async join(ws: WebSocket, channel: string, message?: PusherMessage): Promise<JoinResponse> {
        let passedSignature = message?.data?.auth;
        let signatureIsValid = await this.signatureIsValid(ws.app, ws.id, message, passedSignature);

        if (!signatureIsValid) {
            return {
                ws,
                success: false,
                errorCode: 4009,
                errorMessage: 'The connection is unauthorized.',
                authError: true,
                type: 'AuthError',
            };
        }

        let joinResponse = await super.join(ws, channel, message);

        // If the users joined to a private channel with authentication,
        // proceed clearing the authentication timeout.
        if (joinResponse.success && ws.userAuthenticationTimeout) {
            await ws.clearUserAuthenticationTimeout();
        }

        return joinResponse;
    }

    protected async signatureIsValid(app: App, socketId: string, message: PusherMessage, signatureToCheck: string): Promise<boolean> {
        return signatureToCheck === (await this.getExpectedSignature(app, socketId, message));
    }

    protected async getExpectedSignature(app: App, socketId: string, message: PusherMessage): Promise<string> {
        let token = new (Pusher as any).Token(app.key, app.secret);
        return `${app.key}:${token.sign(this.getDataToSignForSignature(socketId, message))}`;
    }

    protected getDataToSignForSignature(socketId: string, message: PusherMessage): string {
        return `${socketId}:${message.data.channel}`;
    }
}
