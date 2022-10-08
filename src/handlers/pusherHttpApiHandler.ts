import { App } from '../app-managers/app';
import { CorsMiddleware } from '../middleware/cors-middleware';
import { HttpRequest } from 'uWebSockets.js';
import { HttpResponse, HttpUtils } from '../utils/http-utils';
import { InitializeResponseMiddleware } from '../middleware/initialize-response-middleware';
import { MiddlewareClass } from '../middleware/middleware-class';
import { PusherApiMessage, SentPusherMessage } from '../message';
import { WsUtils } from '../utils/ws-utils';
import { WebsocketsNode } from '../websocketsNode';
import { MetricsUtils } from '../utils/metrics-utils';

export interface ChannelResponse {
    subscription_count: number;
    user_count?: number;
    occupied: boolean;
}

// TODO: Make use of
export interface MessageCheckError {
    message: string;
    code: number;
}

export class PusherHttpApiHandler {
    static wsNode: WebsocketsNode;

    static async serve(fn: string, res: HttpResponse, req: HttpRequest, middleware: MiddlewareClass[] = [], namedParams: string[] = []): Promise<HttpResponse> {
        await HttpUtils.applyMiddleware(res, [
            new InitializeResponseMiddleware(this.wsNode),
            new CorsMiddleware(this.wsNode),
        ]);

        await HttpUtils.extractRequestDetails(res, req, namedParams)
        await HttpUtils.applyMiddleware(res, middleware);

        return this[fn](res, middleware);
    }

    static async healthCheck(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        return HttpUtils.send(res, 'OK');
    }

    static async ready(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        return this.wsNode.closing
            ? HttpUtils.serverErrorResponse(res, 'The server is closing. Choose another server. :)')
            : HttpUtils.send(res, 'OK');
    }

    static async acceptTraffic(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        if (this.wsNode.closing) {
            return HttpUtils.serverErrorResponse(res, 'The server is closing. Choose another server. :)');
        }

        return res;

        // TODO: Implement
        /* let threshold = this.server.options.httpApi.acceptTraffic.memoryThreshold;

        let {
            rss,
            heapTotal,
            external,
            arrayBuffers,
        } = process.memoryUsage();

        let totalSize = v8.getHeapStatistics().total_available_size;
        let usedSize = rss + heapTotal + external + arrayBuffers;
        let percentUsage = (usedSize / totalSize) * 100;

        if (threshold < percentUsage) {
            return this.serverErrorResponse(res, 'Low on memory here. Choose another server. :)');
        }

        this.sendJson(res, {
            memory: {
                usedSize,
                totalSize,
                percentUsage,
            },
        }); */
    }

    static async channels(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        let channels = await this.wsNode.namespace(res.params.appId).getChannelsWithSocketsCount();

        let response: { [channel: string]: ChannelResponse } = [...channels].reduce((channels, [channel, connections]) => {
            if (connections === 0) {
                return channels;
            }

            // In case ?filter_by_prefix= is specified, the channel must start with that prefix.
            if (res.query.filter_by_prefix && !channel.startsWith(res.query.filter_by_prefix)) {
                return channels;
            }

            channels[channel] = {
                subscription_count: connections,
                occupied: true,
            };

            return channels;
        }, {});

        return HttpUtils.sendJson(res, { channels: response });
    }

    static async channel(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        let response: ChannelResponse;

        let socketsCount = await this.wsNode
            .namespace(res.params.appId)
            .getChannelSocketsCount(res.params.channel);

        response = {
            subscription_count: socketsCount,
            occupied: socketsCount > 0,
        };

        // For presence channels, attach an user_count.
        // Avoid extra call to get channel members if there are no sockets.
        if (WsUtils.isPresenceChannel(res.params.channel)) {
            response.user_count = 0;

            if (response.subscription_count > 0) {
                let membersCount = await this.wsNode
                    .namespace(res.params.appId)
                    .getChannelMembersCount(res.params.channel);

                return HttpUtils.sendJson(res, {
                    ...response,
                    ...{
                        user_count: membersCount,
                    },
                });
            }
        }

        return HttpUtils.sendJson(res, response);
    }

    static async channelUsers(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        if (!WsUtils.isPresenceChannel(res.params.channel)) {
            return HttpUtils.badResponse(res, 'The channel must be a presence channel.');
        }

        let members = await this.wsNode
            .namespace(res.params.appId)
            .getChannelMembers(res.params.channel);

        return HttpUtils.sendJson(res, {
            users: [...members].map(([user_id, user_info]) => {
                return res.query.with_user_info === '1'
                    ? { id: user_id, user_info }
                    : { id: user_id };
            }),
        });
    }

    static async events(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        try {
            let message = await this.checkMessageToBroadcast(res.body as PusherApiMessage, res.app);

            await this.broadcastMessage(message, res.app.id);

            return HttpUtils.sendJson(res, { ok: true });
        } catch (error) {
            if (error.code === 400) {
                return HttpUtils.badResponse(res, error.message);
            } else if (error.code === 413) {
                return HttpUtils.entityTooLargeResponse(res, error.message);
            }
        }
    }

    static async batchEvents(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        let batch = res.body.batch as PusherApiMessage[];

        // Make sure the batch size is not too big.
        if (batch.length > res.app.maxEventBatchSize) {
            return HttpUtils.badResponse(res, `Cannot batch-send more than ${res.app.maxEventBatchSize} messages at once`);
        }

        try {
            let messages = await Promise.all(
                batch.map(message => this.checkMessageToBroadcast(message, res.app as App))
            );

            for await (let message of messages) {
                await this.broadcastMessage(message, res.app.id);
            }

            return HttpUtils.sendJson(res, { ok: true });
        } catch (error) {
            if (error.code === 400) {
                return HttpUtils.badResponse(res, error.message);
            } else if (error.code === 413) {
                return HttpUtils.entityTooLargeResponse(res, error.message);
            }
        };
    }

    static async terminateUserConnections(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        this.wsNode.namespace(res.app.id).terminateUserConnections(res.params.userId);
        return HttpUtils.sendJson(res, { ok: true });
    }

    static async notFound(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        res.writeStatus('404 Not Found');
        return HttpUtils.send(res, '', '404 Not Found');
    }

    protected static async checkMessageToBroadcast(message: PusherApiMessage, app: App): Promise<PusherApiMessage> {
        return new Promise((resolve, reject) => {
            if (
                (!message.channels && !message.channel) ||
                !message.name ||
                !message.data
            ) {
                return reject({
                    message: 'The received data is incorrect',
                    code: 400,
                });
            }

            let channels: string[] = message.channels || [message.channel];

            message.channels = channels;

            // Make sure the channels length is not too big.
            if (channels.length > app.maxEventChannelsAtOnce) {
                return reject({
                    message: `Cannot broadcast to more than ${app.maxEventChannelsAtOnce} channels at once`,
                    code: 400,
                });
            }

            // Make sure the event name length is not too big.
            if (message.name.length > app.maxEventNameLength) {
                return reject({
                    message: `Event name is too long. Maximum allowed size is ${app.maxEventNameLength}.`,
                    code: 400,
                });
            }

            let payloadSizeInKb = MetricsUtils.dataToKilobytes(message.data);

            // Make sure the total payload of the message body is not too big.
            if (payloadSizeInKb > parseFloat(app.maxEventPayloadInKb as string)) {
                return reject({
                    message: `The event data should be less than ${app.maxEventPayloadInKb} KB.`,
                    code: 413,
                });
            }

            resolve(message);
        });
    }

    protected static async broadcastMessage(message: PusherApiMessage, appId: string): Promise<void> {
        for await (let channel of message.channels) {
            let msg: SentPusherMessage = {
                event: message.name,
                channel,
                data: message.data,
            };

            this.wsNode.namespace(appId).broadcastMessage(channel, msg, message.socket_id);

            // TODO: Cache message
            /* if (WsUtils.isCachingChannel(channel)) {
                this.server.cacheManager.set(
                    `app:${appId}:channel:${channel}:cache_miss`,
                    JSON.stringify({ event: msg.event, data: msg.data }),
                    this.server.options.channelLimits.cacheTtl,
                );
            } */
        }
    }
}
