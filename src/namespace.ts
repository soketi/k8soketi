import { PresenceMember, PresenceMemberInfo } from './handlers/pusherWebsocketsHandler';
import { Log } from './log';
import { WebSocket } from './websocket';
import { WebsocketsNode } from './websocketsNode';

export interface PeerRequestData {
    version?: string;
    data: { [key: string]: any; };
}

export class Namespace {
    channels: Map<string, Set<string>> = new Map();
    sockets: Map<string, WebSocket> = new Map();
    users: Map<number|string, Set<string>> = new Map();

    constructor(protected appId: string, protected wsNode: WebsocketsNode) {
        //
    }

    // @Reflect.metadata('onlyLocal', true)
    async addSocket(ws: WebSocket): Promise<boolean> {
        this.sockets.set(ws.id, ws);
        return true;
    }

    // @Reflect.metadata('onlyLocal', true)
    async removeSocket(wsId: string): Promise<boolean> {
        this.removeFromChannel(wsId, [...this.channels.keys()]);
        return this.sockets.delete(wsId);
    }

    // @Reflect.metadata('onlyLocal', true)
    async addToChannel(ws: WebSocket, channel: string): Promise<number> {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set);
        }

        this.channels.get(channel).add(ws.id);

        return this.channels.get(channel).size;
    }

    // @Reflect.metadata('onlyLocal', true)
    async removeFromChannel(wsId: string, channel: string|string[]): Promise<number|void> {
        let remove = (channel) => {
            if (this.channels.has(channel)) {
                this.channels.get(channel).delete(wsId);

                if (this.channels.get(channel).size === 0) {
                    this.channels.delete(channel);
                }
            }
        };

        if (Array.isArray(channel)) {
            for await (let ch of channel) {
                remove(ch);
            }

            return;
        }

        remove(channel);

        return this.channels.has(channel)
            ? this.channels.get(channel).size
            : 0;
    }

    // @Reflect.metadata('onlyLocal', true)
    async isInChannel(wsId: string, channel: string): Promise<boolean> {
        if (!this.channels.has(channel)) {
            return false;
        }

        return this.channels.get(channel).has(wsId);
    }

    // @Reflect.metadata('onlyLocal', true)
    async getChannels(): Promise<Map<string, Set<string>>> {
        return this.channels;
    }

    // @Reflect.metadata('onlyLocal', true)
    async addUser(ws: WebSocket): Promise<void> {
        if (!ws.user) {
            return;
        }

        if (!this.users.has(ws.user.id)) {
            this.users.set(ws.user.id, new Set());
        }

        if (!this.users.get(ws.user.id).has(ws.id)) {
            this.users.get(ws.user.id).add(ws.id);
        }
    }

    // @Reflect.metadata('onlyLocal', true)
    async removeUser(ws: WebSocket): Promise<void> {
        if (!ws.user) {
            return;
        }

        if (this.users.has(ws.user.id)) {
            this.users.get(ws.user.id).delete(ws.id);
        }

        if (this.users.get(ws.user.id) && this.users.get(ws.user.id).size === 0) {
            this.users.delete(ws.user.id);
        }
    }

    // @Reflect.metadata('onlyLocal', true)
    async getUserSockets(userId: string|number, onlyLocal = false): Promise<Set<WebSocket>> {
        let wsIds = this.users.get(userId);

        if (!wsIds || wsIds.size === 0) {
            return new Set();
        }

        return [...wsIds].reduce((sockets, wsId) => {
            sockets.add(this.sockets.get(wsId));
            return sockets;
        }, new Set<WebSocket>());
    }

    async getSockets(onlyLocal = false): Promise<Map<string, WebSocket>> {
        return this.sockets;
    }

    async getSocketsCount(onlyLocal = false): Promise<number> {
        let size = this.sockets.size;

        if (!onlyLocal) {
            let data = await this.makeRequestToAllPeers({
                data: {
                    appId: this.appId,
                    method: 'getSocketsCount',
                    args: [true],
                },
            });

            for await (let socketsCount of data) {
                size += socketsCount;
            }
        }

        return size;
    }

    async getChannelsWithSocketsCount(onlyLocal = false): Promise<Map<string, number>> {
        let channels = await this.getChannels();
        let list = new Map<string, number>();

        for await (let [channel, connections] of channels) {
            list.set(channel, connections.size);
        }

        if (!onlyLocal) {
            let dataFromPeers = await this.makeRequestToAllPeers({
                data: {
                    appId: this.appId,
                    method: 'getChannelsWithSocketsCount',
                    args: [true],
                },
            });
        }

        return list;
    }

    async getChannelSockets(channel: string, onlyLocal = false): Promise<Map<string, WebSocket>> {
        if (!this.channels.has(channel)) {
            return new Map<string, WebSocket>();
        }

        let wsIds = this.channels.get(channel);

        return Array.from(wsIds).reduce((sockets, wsId) => {
            if (!this.sockets.has(wsId)) {
                return sockets;
            }

            return sockets.set(wsId, this.sockets.get(wsId));
        }, new Map<string, WebSocket>());
    }

    async getChannelMembers(channel: string, onlyLocal = false): Promise<Map<string, PresenceMemberInfo>> {
        let sockets = await this.getChannelSockets(channel);

        return Array.from(sockets).reduce((members, [wsId, ws]) => {
            let member: PresenceMember = ws.presence ? ws.presence.get(channel) : null;

            if (member) {
                members.set(member.user_id as string, member.user_info);
            }

            return members;
        }, new Map<string, PresenceMemberInfo>());
    }

    async getChannelMembersCount(channel: string, onlyLocal = false): Promise<number> {
        return (await this.getChannelMembers(channel)).size;
    }

    async terminateUserConnections(userId: number|string, onlyLocal = false): Promise<void> {
        let sockets = await this.getSockets();

        for await (let [, ws] of sockets) {
            if (!ws.user || ws.user.id != userId) {
                continue;
            }

            await ws.sendJsonAndClose({
                event: 'pusher:error',
                data: {
                    code: 4009,
                    message: 'You got disconnected by the app.',
                },
            }, 4009);
        };
    }

    async broadcastMessage(channel: string, data: string, exceptingId: string|null = null, onlyLocal = false): Promise<void> {
        if (!onlyLocal) {
            await this.makeRequestToAllPeers({
                data: {
                    appId: this.appId,
                    method: 'broadcastMessage',
                    args: [
                        channel,
                        data,
                        exceptingId,
                        true,
                    ],
                },
            });
        }

        // For user-dedicated channels, intercept the .send() call and use custom logic.
        if (channel.indexOf('#server-to-user-') === 0) {
            let userId = channel.split('#server-to-user-').pop();
            let sockets = await this.getUserSockets(userId);

            for await (let ws of sockets) {
                if (ws.sendJson) {
                    await ws.sendJson(JSON.parse(data));
                }
            }

            return;
        }

        let sockets = await this.getChannelSockets(channel, true);

        for await (let [wsId, ws] of sockets) {
            if (exceptingId && exceptingId === ws.id) {
                return;
            }

            // Fix race conditions.
            if (ws.sendJson) {
                await ws.sendJson(JSON.parse(data));
            }
        }
    }

    protected async makeRequestToAllPeers({ version = '1', data }: PeerRequestData): Promise<any[]> {
        let peers = this.wsNode.peerNode.subscribedPeers(`app-${this.appId}`);

        if (peers.length === 0) {
            return [];
        }

        let promises = [];

        for await (let peerId of peers) {
            promises.push(
                this.wsNode.peerNode.makeRequest({
                    peerId,
                    action: 'call-namespace-fn',
                    data,
                    version,
                })
            );
        }

        Log.info(`[Request][App: ${this.appId}] Making request to ${peers.length} peers.`);

        return await Promise.all(promises);
    }
}
