import ab2str from 'arraybuffer-to-string';
import { App } from '../app-managers/app';
import { AppManager } from '../app-managers/app-manager';
import { CacheManager } from '../cache-managers/cache-manager';
import { HttpRequest, HttpResponse } from 'uWebSockets.js';
import { Log } from '../log';
import { MetricsUtils } from '../utils/metrics-utils';
import { PresenceChannelManager } from '../pusher-channels/presence-channel-manager';
import { Prometheus } from '../prometheus';
import { PusherMessage, uWebSocketMessage } from '../message';
import { RateLimiter } from '../rate-limiters/rate-limiter';
import { WebsocketsNode } from '../websocketsNode';
import { WebSocket } from '../websocket';
import { WsUtils } from '../utils/ws-utils';
import { PusherWebhookSender } from '../webhook-sender/pusher-webhook-sender';

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
    static wsNode: WebsocketsNode;

    static async onOpen(ws: WebSocket): Promise<any> {
        Log.info(`[Pusher][WebSockets] New connection from ${ws.ip} with key ${ws.appKey}`);

        await this.attachDefaultDataToConnection(ws);

        if (this.wsNode.closing) {
            await ws.sendJsonAndClose({
                event: 'pusher:error',
                data: {
                    code: 4200,
                    message: 'Server is closing. Please reconnect shortly.',
                },
            }, 4200);

            await this.wsNode.evictSocketFromMemory(ws);
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

        this.wsNode.subscribeToApp(ws.app.id);

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
            }, 30e3);
        }

        // Make sure to update the socket after new data was pushed in.
        await this.wsNode.namespace(ws.app.id).addSocket(ws);

        await ws.sendJson({
            event: 'pusher:connection_established',
            data: JSON.stringify({ socket_id: ws.id, activity_timeout: 30 }),
        });

        if (ws.app.enableUserAuthentication) {
            ws.setUserAuthenticationTimeout(ws);
        }

        Prometheus.newConnection(ws);
    }

    static async onMessage(ws: WebSocket, message: uWebSocketMessage, isBinary: boolean): Promise<any> {
        if (this.wsNode.closing) {
            await ws.sendJsonAndClose({
                event: 'pusher:error',
                data: {
                    code: 4200,
                    message: 'Server is closing. Please reconnect shortly.',
                },
            }, 4200);

            await this.wsNode.evictSocketFromMemory(ws);
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

        Prometheus.receivedWsMessage(ws.app.id, stringMessage);

        switch (message.event) {
            case 'pusher:ping': await this.handlePingMessage(ws, message); break;
            case 'pusher:subscribe': await this.handleSubscription(ws, message); break;
            case 'pusher:unsubscribe': await this.handleUnsubscribe(ws, message); break;
            case 'pusher:signin': await this.handleSignin(ws, message); break;
            default:
                if (WsUtils.isClientEvent(message.event)) {
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
            await this.wsNode.evictSocketFromMemory(ws);
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
        let channelManager = this.wsNode.getChannelManagerFor(channel);

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
        this.wsNode.namespace(ws.app.id).addSocket(ws);

        if (response.channelConnections === 1) {
            PusherWebhookSender.sendChannelOccupied(ws.app, channel);
        }

        // For non-presence channels, end with subscription succeeded.
        if (!(channelManager instanceof PresenceChannelManager)) {
            await ws.sendJson({
                event: 'pusher_internal:subscription_succeeded',
                channel,
            });

            if (WsUtils.isCachingChannel(channel)) {
                await this.sendMissedCacheIfExists(ws, channel);
            }

            return;
        }

        // Otherwise, prepare a response for the presence channel.
        let members = await this.wsNode.namespace(ws.app.id).getChannelMembers(channel);

        let { user_id, user_info } = response.member;

        ws.presence.set(channel, response.member);

        // Make sure to update the socket after new data was pushed in.
        this.wsNode.namespace(ws.app.id).addSocket(ws);

        // If the member already exists in the channel, don't resend the member_added event.
        if (!members.has(user_id as string)) {
            PusherWebhookSender.sendMemberAdded(ws.app, channel, user_id as string);

            await this.wsNode.namespace(ws.app.id).broadcastMessage(
                channel,
                {
                    event: 'pusher_internal:member_added',
                    channel,
                    data: JSON.stringify({
                        user_id: user_id,
                        user_info: user_info,
                    }),
                },
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

        if (WsUtils.isCachingChannel(channel)) {
            await this.sendMissedCacheIfExists(ws, channel);
        }
    }

    protected static async handleUnsubscribe(ws: WebSocket, message: PusherMessage): Promise<void> {
        await this.unsubscribeFromChannel(ws, message.channel);
    }

    protected static async handleClientEvent(ws: WebSocket, message: PusherMessage): Promise<void> {
        let { event, data, channel } = message;

        if (!ws.app.enableClientMessages) {
            return await ws.sendJson({
                event: 'pusher:error',
                channel,
                data: {
                    code: 4301,
                    message: `The app does not have client messaging enabled.`,
                },
            });
        }

        // Make sure the event name length is not too big.
        if (event.length > ws.app.maxEventNameLength) {
            return await ws.sendJson({
                event: 'pusher:error',
                channel,
                data: {
                    code: 4301,
                    message: `Event name is too long. Maximum allowed size is ${ws.app.maxEventNameLength}.`,
                },
            });
        }

        let payloadSizeInKb = MetricsUtils.dataToKilobytes(message.data);

        // Make sure the total payload of the message body is not too big.
        if (payloadSizeInKb > parseFloat(ws.app.maxEventPayloadInKb as string)) {
            return await ws.sendJson({
                event: 'pusher:error',
                channel,
                data: {
                    code: 4301,
                    message: `The event data should be less than ${ws.app.maxEventPayloadInKb} KB.`,
                },
            });
        }

        let canBroadcast = await this.wsNode.namespace(ws.app.id).isInChannel(channel, ws.id);

        if (!canBroadcast) {
            return;
        }

        let response = await RateLimiter.consumeFrontendEventPoints(1, ws.app, ws);

        if (!response.canContinue) {
            return await ws.sendJson({
                event: 'pusher:error',
                channel,
                data: {
                    code: 4301,
                    message: 'The rate limit for sending client events exceeded the quota.',
                },
            });
        }

        let userId = ws.presence.has(channel) ? ws.presence.get(channel).user_id : null;

        let formattedMessage = {
            event,
            channel,
            data,
            ...userId ? { user_id: userId } : {},
        };

        this.wsNode.namespace(ws.app.id).broadcastMessage(channel, formattedMessage, ws.id);

        PusherWebhookSender.sendClientEvent(
            ws.app, channel, event, data, ws.id, userId as string,
        );
    }

    protected static async handleSignin(ws: WebSocket, message: PusherMessage): Promise<void> {
        if (!ws.userAuthenticationTimeout) {
            return;
        }

        let isValid = await this.signinTokenIsValid(ws, message.data.user_data, message.data.auth);

        if (!isValid) {
            return await ws.sendJsonAndClose({
                event: 'pusher:error',
                data: {
                    code: 4009,
                    message: 'Connection not authorized.',
                },
            }, 4009);
        }

        let decodedUser = JSON.parse(message.data.user_data);

        if (!decodedUser.id) {
            return await ws.sendJsonAndClose({
                event: 'pusher:error',
                data: {
                    code: 4009,
                    message: 'The returned user data must contain the "id" field.',
                },
            }, 4009);
        }

        ws.user = {
            ...decodedUser,
            ...{
                id: decodedUser.id.toString(),
            },
        };

        await ws.clearUserAuthenticationTimeout();
        await this.wsNode.namespace(ws.app.id).addUser(ws);

        this.wsNode.namespace(ws.app.id).addSocket(ws);

        await ws.sendJson({
            event: 'pusher:signin_success',
            data: message.data,
        });
    }

    static async closeAllLocalSockets(): Promise<void> {
        if (this.wsNode.namespaces.size === 0) {
            return Promise.resolve();
        }

        for await (let [namespaceId, namespace] of this.wsNode.namespaces) {
            let sockets = namespace.sockets;

            for await (let [, ws] of sockets) {
                await ws.sendJsonAndClose({
                    event: 'pusher:error',
                    data: {
                        code: 4200,
                        message: 'Server closed. Please reconnect shortly.',
                    },
                }, 4200);

                await this.wsNode.evictSocketFromMemory(ws);
            }

            await this.wsNode.clearNamespace(namespaceId);
        }

        await this.wsNode.clearNamespaces();

        Log.info(`[WebSockets][Pusher] Closed all local sockets.`);
    }

    static async unsubscribeFromAllChannels(ws: WebSocket, closing = true): Promise<void> {
        if (!ws.subscribedChannels) {
            return;
        }

        for await (let channel of ws.subscribedChannels) {
            await this.unsubscribeFromChannel(ws, channel, closing);
        }

        if (ws.app && ws.user) {
            this.wsNode.namespace(ws.app.id).removeUser(ws);
        }

        Log.info(`[WebSockets][Pusher] Unsubscribed ${ws.id || ws.ip} from all channels.`);
    }

    static async unsubscribeFromChannel(ws: WebSocket, channel: string, closing = false): Promise<void> {
        let channelManager = this.wsNode.getChannelManagerFor(channel);
        let response = await channelManager.leave(ws, channel);
        let member = ws.presence.get(channel);

        if (response.left) {
            // Send presence channel-speific events and delete specific data.
            // This can happen only if the user is connected to the presence channel.
            if (channelManager instanceof PresenceChannelManager && member) {
                ws.presence.delete(channel);

                // Make sure to update the socket after new data was pushed in.
                await this.wsNode.namespace(ws.app.id).addSocket(ws);

                let members = await this.wsNode.namespace(ws.app.id).getChannelMembers(channel);

                if (!members.has(member.user_id as string)) {
                    PusherWebhookSender.sendMemberRemoved(ws.app, channel, member.user_id as string);

                    this.wsNode.namespace(ws.app.id).broadcastMessage(
                        channel,
                        {
                            event: 'pusher_internal:member_removed',
                            channel,
                            data: JSON.stringify({
                                user_id: member.user_id,
                            }),
                        },
                        ws.id,
                    );
                }
            }

            ws.subscribedChannels.delete(channel);

            // Make sure to update the socket after new data was pushed in,
            // but only if the user is not closing the connection.
            if (!closing) {
                this.wsNode.namespace(ws.app.id).addSocket(ws);
            }

            if (response.remainingConnections === 0) {
                PusherWebhookSender.sendChannelVacated(ws.app, channel);
            }

            Log.info(`[WebSockets][Pusher][Channel: ${channel}] Unsubscribed ${ws.id || ws.ip}`);
        }
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
            }, 120e3);
        }

        ws.sendJson = async (data) => {
            try {
                ws.updatePingTimeout();
                ws.send(JSON.stringify(data));
                Log.info(`[Pusher][WebSockets] Sent message to ${ws.id}: ${JSON.stringify(data)}`);
                Prometheus.sentWsMessage(data, ws);
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
        let currentConnectionsCount = await this.wsNode.namespace(ws.app.id).getSocketsCount();
        let maxConnections = parseInt(ws.app.maxConnections as string) || -1;

        return currentConnectionsCount + 1 <= maxConnections || maxConnections < 0;
    }

    protected static async generateSocketId(): Promise<string> {
        let min = 0;
        let max = 10000000000;

        let randomNumber = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

        return `${randomNumber(min, max)}.${randomNumber(min, max)}`;
    }

    protected static async checkForValidApp(ws: WebSocket): Promise<App|null> {
        return AppManager.findByKey(ws.appKey);
    }

    protected static async sendMissedCacheIfExists(ws: WebSocket, channel: string): Promise<void> {
        let cachedEvent = await CacheManager.get(`app:${ws.app.id}:channel:${channel}:cache_miss`);

        if (cachedEvent) {
            await ws.sendJson({
                event: 'pusher:cache_miss',
                channel,
                data: cachedEvent,
            });
        } else {
            PusherWebhookSender.sendCacheMissed(ws.app, channel);
        }
    }

    protected static async signinTokenIsValid(ws: WebSocket, userData: string, signatureToCheck: string): Promise<boolean> {
        return (await this.signinTokenForUserData(ws, userData)) === signatureToCheck;
    }

    protected static async signinTokenForUserData(ws: WebSocket, userData: string): Promise<string> {
        return `${ws.app.key}:${ws.app.signString(`${ws.id}::user::${userData}`)}`;
    }
}
