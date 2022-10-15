import { AppApiBatchBroadcastRateLimiter } from './middleware/app-api-batch-broadcast-rate-limiter';
import { AppApiBroadcastRateLimiter } from './middleware/app-api-broadcast-rate-limiter';
import { AppApiReadRateLimiter } from './middleware/app-api-read-rate-limiter';
import { AppAuthenticationMiddleware } from './middleware/app-authentication-middleware';
import { AppManager } from './app-managers/app-manager';
import { AppRetrievalMiddleware } from './middleware/app-retrieval-middleware';
import { CacheManager } from './cache-managers/cache-manager';
import { EncryptedPrivateChannelManager } from './pusher-channels/encrypted-private-channel-manager';
import { ExtractJsonBodyMiddleware } from './middleware/extract-json-body-middleware';
import { HttpRequest, HttpResponse, TemplatedApp } from 'uWebSockets.js';
import { Log } from './log';
import { Namespace } from './namespace';
import { Options } from './options';
import { PeerNode } from './peerNode';
import { PresenceChannelManager } from './pusher-channels/presence-channel-manager';
import { PrivateChannelManager } from './pusher-channels/private-channel-manager';
import { Prometheus } from './prometheus';
import { PublicChannelManager } from './pusher-channels/public-channel-manager';
import { PubsubAppMessage, uWebSocketMessage } from './message';
import { PusherHttpApiHandler } from './handlers/pusher-http-api-handler';
import { PusherWebhookSender } from './webhook-sender/pusher-webhook-sender';
import { PusherWebsocketsHandler } from './handlers/pusher-websockets-handler';
import { QueueManager } from './queues/queue-manager';
import { RateLimiter } from './rate-limiters/rate-limiter';
import uWS from 'uWebSockets.js';
import { WebSocket } from './websocket';
import { WsUtils } from './utils/ws-utils';

export class WebsocketsNode {
    protected app: TemplatedApp;
    protected process: uWS.us_listen_socket;
    peerNode: PeerNode;
    closing = false;
    ready = false;

    subscribedApps: Set<string> = new Set();
    subscribedAppsIntervals: Map<string, NodeJS.Timer> = new Map();
    namespaces: Map<string, Namespace> = new Map<string, Namespace>();

    appManager: AppManager;
    cacheManager: CacheManager;

    protected publicChannelManager: PublicChannelManager;
    protected privateChannelManager: PrivateChannelManager;
    protected encryptedPrivateChannelManager: EncryptedPrivateChannelManager;
    protected presenceChannelManager: PresenceChannelManager;

    constructor(public options: Options) {
        this.publicChannelManager = new PublicChannelManager(this);
        this.privateChannelManager = new PrivateChannelManager(this);
        this.encryptedPrivateChannelManager = new EncryptedPrivateChannelManager(this);
        this.presenceChannelManager = new PresenceChannelManager(this);
    }

    async initialize(peerNode: PeerNode): Promise<void> {
        this.peerNode = peerNode;
        this.app = uWS.App();

        PusherWebsocketsHandler.wsNode = this;
        PusherHttpApiHandler.wsNode = this;

        await this.registerPusherRoutes();
        await this.bootstrapManagers();
        await this.registerProtocols();
    }

    async start(): Promise<void> {
        this.app.listen(this.options.websockets.server.host, this.options.websockets.server.port, process => {
            this.process = process;

            Log.info(`📡 The Websockets server is available at 127.0.0.1:${this.options.websockets.server.port}`, true);
            Log.info(`🔗 The HTTP API server is available at http://127.0.0.1:${this.options.websockets.server.port}`, true);
        });
    }

    async stop(): Promise<void> {
        this.closing = true;
        uWS.us_listen_socket_close(this.process);
    }

    async subscribeToApp(appId: string): Promise<void> {
        if (this.subscribedApps.has(appId)) {
            return;
        }

        this.subscribedApps.add(appId);

        await this.peerNode.subscribeToTopic(`app-${appId}`, (message: PubsubAppMessage) => {
            Log.info(`[Pubsub][Topic: app-${appId}] Received message: ${JSON.stringify(message)}`);
        });

        this.subscribedAppsIntervals.set(appId, setInterval(async () => {
            if ((await this.namespace(appId).getSocketsCount(true)) === 0) {
                await this.unsubscribeFromApp(appId);
            } else {
                // Heartbeat to keep the PeerId alive.
                await this.peerNode.publishMessage(`app-${appId}`, {});
            }
        }, 5e3));
    }

    async unsubscribeFromApp(appId: string): Promise<void> {
        if (!this.subscribedApps.has(appId)) {
            return;
        }

        this.peerNode.unsubscribeFromTopic(`app-${appId}`);
        clearInterval(this.subscribedAppsIntervals.get(appId));
        this.subscribedAppsIntervals.delete(appId);
        this.subscribedApps.delete(appId);

        Log.info(`[WebSockets][App: ${appId}] Unsubscribed from app local events.`);
    }

    async registerProtocols(): Promise<void> {
        await this.peerNode.handleRequest({
            action: 'sync',
            version: '1',
            onRequest: async (_request, _peerId, _streamId) => {
                return JSON.stringify({
                    subscribedApps: [...this.subscribedApps],
                });
            },
        });

        await this.peerNode.handleRequest({
            action: 'call-namespace-fn',
            version: '1',
            onRequest: async ({ appId, method, args }) => {
                let response = await this.namespace(appId)[method](...args);
                let responseString = response;

                if (response instanceof Map || response instanceof Set) {
                    responseString = JSON.stringify([...response]);
                } else if (typeof response === 'number') {
                    // If int === float, it means the number is integer.
                    // If not, it's float. Usually, this could have been
                    // kept at the float level, but let's not mix types. :)
                    let potentialNumber = response.toString();
                    let potentialInteger = parseInt(potentialNumber);
                    let potentialFloat = parseFloat(potentialNumber);

                    responseString = potentialInteger === potentialFloat
                        ? potentialInteger
                        : potentialFloat;
                }

                return responseString;
            },
        });
    }

    async evictSocketFromMemory(ws: WebSocket): Promise<void> {
        await PusherWebsocketsHandler.unsubscribeFromAllChannels(ws, true);

        if (ws.app) {
            await this.namespace(ws.app.id).removeSocket(ws.id);
        }

        await ws.clearPingTimeout();

        Prometheus.newDisconnection(ws);
    }

    protected async registerPusherRoutes(): Promise<void> {
        this.app.ws('/app/:key', {
            idleTimeout: 120,
            maxBackpressure: 1024 * 1024, // TODO: Configure
            maxPayloadLength: 100 * 1024 * 1024, // TODO: Configure
            open: async (ws: WebSocket) => {
                return await PusherWebsocketsHandler.onOpen(ws);
            },
            message: async (ws: WebSocket, message: uWebSocketMessage, isBinary: boolean) => {
                return await PusherWebsocketsHandler.onMessage(ws, message, isBinary);
            },
            close: async (ws: WebSocket, code: number, message: uWebSocketMessage) => {
                return await PusherWebsocketsHandler.onClose(ws, code, message);
            },
            upgrade: async (res: HttpResponse, req: HttpRequest, context) => {
                return await PusherWebsocketsHandler.onUpgrade(res, req, context);
            },
        });

        this.app.get('/', async (res, req) => {
            return await PusherHttpApiHandler.serve('healthCheck', res, req);
        });

        this.app.get('/ready', async (res, req) => {
            return await PusherHttpApiHandler.serve('ready', res, req);
        });

        this.app.get('/accept-traffic', async (res, req) => {
            return await PusherHttpApiHandler.serve('acceptTraffic', res, req);
        });

        this.app.get('/apps/:appId/channels', async (res, req) => {
            return await PusherHttpApiHandler.serve('channels', res, req, [
                new AppRetrievalMiddleware(this),
                new AppAuthenticationMiddleware(this),
                new AppApiReadRateLimiter(this),
            ], ['appId']);
        });

        this.app.get('/apps/:appId/channels/:channelName', async (res, req) => {
            return await PusherHttpApiHandler.serve('channel', res, req, [
                new AppRetrievalMiddleware(this),
                new AppAuthenticationMiddleware(this),
                new AppApiReadRateLimiter(this),
            ], ['appId', 'channelName']);
        });

        this.app.get('/apps/:appId/channels/:channelName/users', async (res, req) => {
            return await PusherHttpApiHandler.serve('channelUsers', res, req, [
                new AppRetrievalMiddleware(this),
                new AppAuthenticationMiddleware(this),
                new AppApiReadRateLimiter(this),
            ], ['appId', 'channelName']);
        });

        this.app.post('/apps/:appId/events', async (res, req) => {
            return await PusherHttpApiHandler.serve('events', res, req, [
                new ExtractJsonBodyMiddleware(this),
                new AppRetrievalMiddleware(this),
                new AppAuthenticationMiddleware(this),
                new AppApiBroadcastRateLimiter(this),
            ], ['appId']);
        });

        this.app.post('/apps/:appId/batch_events', async (res, req) => {
            return await PusherHttpApiHandler.serve('batchEvents', res, req, [
                new ExtractJsonBodyMiddleware(this),
                new AppRetrievalMiddleware(this),
                new AppAuthenticationMiddleware(this),
                new AppApiBatchBroadcastRateLimiter(this),
            ], ['appId']);
        });

        this.app.post('/apps/:appId/users/:userId/terminate_connections', async (res, req) => {
            return await PusherHttpApiHandler.serve('terminateUserConnections', res, req, [
                new AppRetrievalMiddleware(this),
                new AppAuthenticationMiddleware(this),
            ], ['appId', 'userId']);
        });

        this.app.any('/*', async (res, req) => {
            return await PusherHttpApiHandler.serve('notFound', res, req);
        });
    }

    protected async bootstrapManagers(): Promise<void> {
        await RateLimiter.initialize(this.options);
        await CacheManager.initialize(this.options);
        await AppManager.initialize(this.options);
        await QueueManager.initialize(this.options);
        await PusherWebhookSender.initialize(this.options);
    }

    namespace(appId: string): Namespace {
        if (!this.namespaces.has(appId)) {
            this.namespaces.set(appId, new Namespace(appId, this));
        }

        return this.namespaces.get(appId);
    }

    async clearNamespace(namespaceId: string): Promise<void> {
        this.namespaces.set(namespaceId, new Namespace(namespaceId, this));
    }

    async clearNamespaces(): Promise<void> {
        this.namespaces = new Map();
    }

    getChannelManagerFor(channel: string): PublicChannelManager|PrivateChannelManager|EncryptedPrivateChannelManager|PresenceChannelManager {
        if (WsUtils.isPresenceChannel(channel)) {
            return this.presenceChannelManager;
        }

        if (WsUtils.isEncryptedPrivateChannel(channel)) {
            return this.encryptedPrivateChannelManager;
        }

        if (WsUtils.isPrivateChannel(channel)) {
            return this.privateChannelManager;
        }

        return this.publicChannelManager;
    }
}
