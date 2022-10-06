import ab2str from 'arraybuffer-to-string';
import { App } from '../app-managers/app';
import { HttpRequest, HttpResponse } from 'uWebSockets.js';
import { Log } from '../log';
import { PresenceChannelManager } from '../pusher-channels/presence-channel-manager';
import { PusherMessage, uWebSocketMessage } from '../message';
import { WebsocketsNode } from '../websocketsNode';
import { WebSocket } from './../websocket';
import { Utils } from '../utils';

export interface PresenceMemberInfo {
    [key: string]: any;
}

export interface PresenceMember {
    user_id: number|string;
    user_info: PresenceMemberInfo;
    socket_id?: string;
}

export interface User {
    id?: string|number;
    [key: string]: any;
}

export class PusherWebsocketsHandler {
    static node: WebsocketsNode;

    static async onOpen(ws: WebSocket): Promise<any> {
        Log.info(`[Pusher][WebSockets] New connection from ${ws.ip} with key ${ws.appKey}`);

        await this.attachDefaultDataToConnection(ws);

        if (this.node.closing) {
            await ws.sendJsonAndClose({
                event: 'pusher:error',
                data: {
                    code: 4200,
                    message: 'Server is closing. Please reconnect shortly.',
                },
            }, 4200);

            await this.node.evictSocketFromMemory(ws);
            return;
        }

        let app = await this.checkForValidApp(ws);

        if (!app) {
            return await ws.sendJsonAndClose({
                event: 'pusher:error',
                data: {
                    code: 4001,
                    message: `An app with key ${ws.appKey} does not exist.`,
                },
            }, 4001);
        }

        if (!app.enabled) {
            return await ws.sendJsonAndClose({
                event: 'pusher:error',
                data: {
                    code: 4003,
                    message: 'The app is not enabled.',
                },
            }, 4003);
        }

        ws.app = app.forWebSocket();

        await this.node.subscribeToApp(ws.app.id);

        let canConnect = await this.canConnect(ws);

        if (!canConnect) {
            return await ws.sendJsonAndClose({
                event: 'pusher:error',
                data: {
                    code: 4004,
                    message: 'The current concurrent connections quota has been reached.',
                },
            }, 4004);
        }

        if (ws.app.enableUserAuthentication) {
            ws.userAuthenticationTimeout = setTimeout(async () => {
                await ws.sendJsonAndClose({
                    event: 'pusher:error',
                    data: {
                        code: 4009,
                        message: 'Connection not authorized within timeout.',
                    },
                }, 4009);
            }, 30_000);
        }

        // Make sure to update the socket after new data was pushed in.
        await this.node.namespace(ws.app.id).addSocket(ws);

        await ws.sendJson({
            event: 'pusher:connection_established',
            data: JSON.stringify({ socket_id: ws.id, activity_timeout: 30 }),
        });

        if (ws.app.enableUserAuthentication) {
            ws.setUserAuthenticationTimeout(ws);
        }
    }

    static async onMessage(ws: WebSocket, message: uWebSocketMessage, isBinary: boolean): Promise<any> {
        if (this.node.closing) {
            await ws.sendJsonAndClose({
                event: 'pusher:error',
                data: {
                    code: 4200,
                    message: 'Server is closing. Please reconnect shortly.',
                },
            }, 4200);

            await this.node.evictSocketFromMemory(ws);
            return;
        }

        let stringMessage: string = ab2str(message);

        Log.info(`[Pusher][WebSockets] New message from ${ws.id || ws.ip}: ${stringMessage}`);

        if (message instanceof ArrayBuffer) {
            try {
                message = JSON.parse(stringMessage) as PusherMessage;
            } catch (err) {
                return;
            }
        }

        switch (message.event) {
            case 'pusher:ping': await this.handlePingMessage(ws, message); break;
            case 'pusher:subscribe': await this.handleSubscription(ws, message); break;
            case 'pusher:unsubscribe': await this.handleUnsubscribe(ws, message); break;
            case 'pusher:signin': await this.handleSignin(ws, message); break;
            default:
                if (Utils.isClientEvent(message.event)) {
                    await this.handleClientEvent(ws, message);
                    return;
                }

                Log.warning(`[Pusher][WebSockets] Unknown message: ${stringMessage}`);
                break;
        }
    }

    static async onClose(ws: WebSocket, code: number, message: uWebSocketMessage): Promise<any> {
        Log.info(`[Pusher][WebSockets] Closing ${ws.id || ws.ip}`);

        // If code 4200 (reconnect immediately) is called, it means the `closeAllLocalSockets()` was called.
        if (code !== 4200) {
            await this.node.evictSocketFromMemory(ws);
        }
    }

    static async onUpgrade(res: HttpResponse, req: HttpRequest, context): Promise<any> {
        return res.upgrade(
            {
                ip: ab2str(res.getRemoteAddressAsText()),
                ip2: ab2str(res.getProxiedRemoteAddressAsText()),
                appKey: req.getParameter(0),
            },
            req.getHeader('sec-websocket-key'),
            req.getHeader('sec-websocket-protocol'),
            req.getHeader('sec-websocket-extensions'),
            context,
        );
    }

    protected static async handlePingMessage(ws: WebSocket, message: PusherMessage): Promise<void> {
        await ws.sendJson({
            event: 'pusher:pong',
            data: {},
        });
    }

    protected static async handleSubscription(ws: WebSocket, message: PusherMessage): Promise<void> {
        let channel = message.data.channel;
        let channelManager = this.node.getChannelManagerFor(channel);

        if (channel.length > ws.app.maxChannelNameLength) {
            return await ws.sendJson({
                event: 'pusher:subscription_error',
                channel,
                data: {
                    type: 'LimitReached',
                    error: `The channel name is longer than the allowed ${ws.app.maxChannelNameLength} characters.`,
                    status: 4009,
                },
            });
        }

        let response = await channelManager.join(ws, channel, message);

        if (!response.success) {
            let { authError, type, errorMessage, errorCode } = response;

            // For auth errors, send pusher:subscription_error
            if (authError) {
                return await ws.sendJson({
                    event: 'pusher:subscription_error',
                    channel,
                    data: {
                        type: 'AuthError',
                        error: errorMessage,
                        status: 401,
                    },
                });
            }

            // Otherwise, catch any non-auth related errors.
            return await ws.sendJson({
                event: 'pusher:subscription_error',
                channel,
                data: {
                    type: type,
                    error: errorMessage,
                    status: errorCode,
                },
            });
        }

        if (!ws.subscribedChannels.has(channel)) {
            ws.subscribedChannels.add(channel);
        }

        // Make sure to update the socket after new data was pushed in.
        this.node.namespace(ws.app.id).addSocket(ws);

        // For non-presence channels, end with subscription succeeded.
        if (!(channelManager instanceof PresenceChannelManager)) {
            await ws.sendJson({
                event: 'pusher_internal:subscription_succeeded',
                channel,
            });

            if (Utils.isCachingChannel(channel)) {
                // TODO: Implement this.sendMissedCacheIfExists(ws, channel);
            }

            return;
        }

        // Otherwise, prepare a response for the presence channel.
        let members = await this.node.namespace(ws.app.id).getChannelMembers(channel);

        let { user_id, user_info } = response.member;

        ws.presence.set(channel, response.member);

        // Make sure to update the socket after new data was pushed in.
        this.node.namespace(ws.app.id).addSocket(ws);

        // If the member already exists in the channel, don't resend the member_added event.
        if (!members.has(user_id as string)) {
            await this.node.namespace(ws.app.id).broadcastMessage(
                channel,
                JSON.stringify({
                    event: 'pusher_internal:member_added',
                    channel,
                    data: JSON.stringify({
                        user_id: user_id,
                        user_info: user_info,
                    }),
                }),
                ws.id,
            );

            members.set(user_id as string, user_info);
        }

        await ws.sendJson({
            event: 'pusher_internal:subscription_succeeded',
            channel,
            data: JSON.stringify({
                presence: {
                    ids: Array.from(members.keys()),
                    hash: Object.fromEntries(members),
                    count: members.size,
                },
            }),
        });

        if (Utils.isCachingChannel(channel)) {
            // TODO: Implement this.sendMissedCacheIfExists(ws, channel);
        }
    }

    protected static async handleUnsubscribe(ws: WebSocket, message: PusherMessage): Promise<void> {
        await this.node.unsubscribeFromChannel(ws, message.channel);
    }

    protected static async handleClientEvent(ws: WebSocket, message: PusherMessage): Promise<void> {
        // TODO: Implement
    }

    protected static async handleSignin(ws: WebSocket, message: PusherMessage): Promise<void> {
        // TODO: Implement
    }

    protected static async attachDefaultDataToConnection(ws: WebSocket): Promise<void> {
        ws.id = await this.generateSocketId();
        ws.subscribedChannels = new Set<string>();
        ws.presence = new Map<string, PresenceMember>();

        ws.clearPingTimeout = async () => {
            if (ws.pingTimeout) {
                clearTimeout(ws.pingTimeout);
            }
        };

        ws.clearUserAuthenticationTimeout = async () => {
            if (ws.userAuthenticationTimeout) {
                clearTimeout(ws.userAuthenticationTimeout);
            }
        }

        ws.updatePingTimeout = async () => {
            await ws.clearPingTimeout();

            ws.pingTimeout = setTimeout(() => {
                try {
                    ws.end(4201);
                } catch (e) {
                    Log.warning(`[Pusher][WebSockets] ${e}`);
                }
            }, 120_000);
        }

        ws.sendJson = async (data) => {
            try {
                ws.updatePingTimeout();
                ws.send(JSON.stringify(data));
                Log.info(`[Pusher][WebSockets] Sent message to ${ws.id}: ${JSON.stringify(data)}`);
            } catch (e) {
                Log.warning(`[Pusher][WebSockets] ${e}`);
            }
        }

        ws.sendJsonAndClose = async (data, code: number) => {
            try {
                await ws.sendJson(data);
                ws.end(code);
            } catch (e) {
                Log.warning(`[Pusher][WebSockets] ${e}`);
            }
        }
    }

    protected static async canConnect(ws: WebSocket): Promise<boolean> {
        let currentConnectionsCount = await this.node.namespace(ws.app.id).getSocketsCount();
        let maxConnections = parseInt(ws.app.maxConnections as string) || -1;

        return currentConnectionsCount + 1 <= maxConnections || maxConnections < 0;
    }

    protected static async generateSocketId(): Promise<string> {
        let min = 0;
        let max = 10000000000;

        let randomNumber = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

        return `${randomNumber(min, max)}.${randomNumber(min, max)}`;
    }

    protected static checkForValidApp(ws: WebSocket): Promise<App|null> {
        return this.node.appManager.findByKey(ws.appKey);
    }
}
