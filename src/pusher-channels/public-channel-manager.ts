import { PresenceMember } from '../handlers/pusherWebsocketsHandler';
import { PusherMessage } from '../message';
import { WebSocket } from './../websocket';
import { WebsocketsNode } from '../websocketsNode';
import { Utils } from '../utils';

export interface JoinResponse {
    ws: WebSocket;
    success: boolean;
    channelConnections?: number;
    authError?: boolean;
    member?: PresenceMember;
    errorMessage?: string;
    errorCode?: number;
    type?: string;
}

export interface LeaveResponse {
    left: boolean;
    remainingConnections?: number;
    member?: PresenceMember;
}

export class PublicChannelManager {
    constructor(protected node: WebsocketsNode) {
        //
    }

    async join(ws: WebSocket, channel: string, message?: PusherMessage): Promise<JoinResponse> {
        if (Utils.restrictedChannelName(channel)) {
            return {
                ws,
                success: false,
                errorCode: 4009,
                errorMessage: 'The channel name is not allowed. Read channel conventions: https://pusher.com/docs/channels/using_channels/channels/#channel-naming-conventions',
            };
        }

        if (!ws.app) {
            return {
                ws,
                success: false,
                errorCode: 4009,
                errorMessage: 'Subscriptions messages should be sent after the pusher:connection_established event is received.',
            };
        }

        let connections = await this.node.namespace(ws.app.id).addToChannel(ws, channel);

        return {
            ws,
            success: true,
            channelConnections: connections,
        };
    }

    async leave(ws: WebSocket, channel: string): Promise<LeaveResponse> {
        let remainingConnections = await this.node.namespace(ws.app.id).removeFromChannel(ws.id, channel);

        return {
            left: true,
            remainingConnections: remainingConnections as number,
        };
    }
}
