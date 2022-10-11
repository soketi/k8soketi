import { JoinResponse, LeaveResponse } from './public-channel-manager';
import { MetricsUtils } from '../utils/metrics-utils';
import { PresenceMember } from '../handlers/pusher-websockets-handler';
import { PrivateChannelManager } from './private-channel-manager';
import { PusherMessage } from '../message';
import { WebSocket } from './../websocket';

export class PresenceChannelManager extends PrivateChannelManager {
    async join(ws: WebSocket, channel: string, message?: PusherMessage): Promise<JoinResponse> {
        let membersCount = await this.wsNode.namespace(ws.app.id).getChannelMembersCount(channel);

        if (membersCount + 1 > ws.app.maxPresenceMembersPerChannel) {
            return {
                success: false,
                ws,
                errorCode: 4004,
                errorMessage: 'The maximum members per presence channel limit was reached',
                type: 'LimitReached',
            };
        }

        let member: PresenceMember = JSON.parse(message.data.channel_data);
        let memberSizeInKb = MetricsUtils.dataToKilobytes(member.user_info);

        if (memberSizeInKb > ws.app.maxPresenceMemberSizeInKb) {
            return {
                success: false,
                ws,
                errorCode: 4301,
                errorMessage: `The maximum size for a channel member is ${ws.app.maxPresenceMemberSizeInKb} KB.`,
                type: 'LimitReached',
            };
        }

        let response = await super.join(ws, channel, message);

        // Make sure to forward the response in case an error occurs.
        if (!response.success) {
            return response;
        }

        return { ...response, ...{ member } };
    }

    async leave(ws: WebSocket, channel: string): Promise<LeaveResponse> {
        let response = await super.leave(ws, channel);

        return {
            ...response,
            ...{ member: ws.presence.get(channel) },
        };
    }

    protected getDataToSignForSignature(socketId: string, message: PusherMessage): string {
        return `${socketId}:${message.data.channel}:${message.data.channel_data}`;
    }
}
