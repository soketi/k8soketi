import bodyParser from 'body-parser';
import express from 'express';
import Pusher from 'pusher';
import PusherJS, { Options } from 'pusher-js';
import Server from '../server';
import tcpPortUsed from 'tcp-port-used';

export interface ShouldRunConditions {
    appManager?: 'array'|'dynamodb';
    queueManager?: 'sync'|'sqs';
}

export class Utils {
    public static wsServers: Server[] = [];
    public static httpServers: any[] = [];

    static async waitForPortsToFreeUp(): Promise<any> {
        return Promise.all([
            tcpPortUsed.waitUntilFree(6001, 500, 5 * 1000),
            tcpPortUsed.waitUntilFree(6002, 500, 5 * 1000),
            tcpPortUsed.waitUntilFree(3001, 500, 5 * 1000),
            tcpPortUsed.waitUntilFree(9601, 500, 5 * 1000),
        ]);
    }

    static newServer(options: any = {}, callback: (server: Server) => void): void {
        options = {
            'websockets.appManagers.drivers.array.apps.0.maxBackendEventsPerSecond': 200,
            'websockets.appManagers.drivers.array.apps.0.maxClientEventsPerSecond': 200,
            'websockets.appManagers.drivers.array.apps.0.maxReadRequestsPerSecond': 200,
            'websockets.appManagers.cache.enabled': true,
            'websockets.appManagers.cache.ttl': -1,
            'websockets.webhooks.batching.enabled': false,
            'websockets.webhooks.batching.duration': 50,
            'metrics.enabled': true,
            ...options,
            'websockets.cacheManagers.driver': process.env.TEST_CACHE_DRIVER || 'memory',
            'websockets.appManagers.driver': process.env.TEST_APP_MANAGER || 'array',
            'websockets.queueManagers.driver': process.env.TEST_QUEUE_DRIVER || 'sync',
            'websockets.rateLimiters.driver': process.env.TEST_RATE_LIMITER || 'local',
            'websockets.server.port': options.port || 6001,
        };

        let server = new Server(options);

        server.start().then(() => {
            callback(server);
        });
    }

    static newClonedServer(server: Server, options = {}, callback: (server: Server) => void): void {
        return this.newServer({
            ...server.options,
            ...options,
        }, callback);
    }

    static newWebhookServer(requestHandler: CallableFunction, onReadyCallback: CallableFunction): any {
        let webhooksApp = express();

        webhooksApp.use(bodyParser.json());

        webhooksApp.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', '*');
            res.header('Access-Control-Allow-Headers', '*');
            next();
        });

        webhooksApp.post('*', requestHandler);

        let server = webhooksApp.listen(3001, () => {
            server.on('error', err => {
                console.log('Websocket server error', err);
            });

            this.httpServers.push(server);

            onReadyCallback(server);
        });
    }

    static async flushHttpServers(): Promise<void> {
        if (this.httpServers.length === 0) {
            return Promise.resolve();
        }

        for await (let server of this.httpServers) {
            await server.close();
        }

        this.httpServers = [];
    }

    static async flushWsServers(): Promise<void> {
        if (this.wsServers.length === 0) {
            return Promise.resolve();
        }

        for await (let server of this.wsServers) {
            await server.stop();
        }

        this.wsServers = [];
    }

    static flushServers(): Promise<any> {
        return Promise.all([
            this.flushWsServers(),
            this.flushHttpServers(),
        ]);
    }

    static newClient(options: Options = {}, port = 6001, key = 'app-key', withStateChange = true): any {
        let client = new PusherJS(key, {
            wsHost: '127.0.0.1',
            httpHost: '127.0.0.1',
            wsPort: port,
            wssPort: port,
            httpPort: port,
            httpsPort: port,
            forceTLS: false,
            disableStats: true,
            enabledTransports: ['ws'],
            ignoreNullOrigin: true,
            // @ts-ignore
            encryptionMasterKeyBase64: 'nxzvbGF+f8FGhk/jOaZvgMle1tqxzF/VfUZLBLhhaH0=',
            ...options,
        });

        if (withStateChange) {
            client.connection.bind('state_change', ({ current }) => {
                if (current === 'unavailable') {
                    console.log('The connection could not be made. Status: ' + current);
                }
            });
        }

        return client;
    }

    static newBackend(appId = 'app-id', key = 'app-key', secret = 'app-secret', port = 6001): any {
        return new Pusher({
            appId,
            key,
            secret,
            host: '127.0.0.1',
            port: port.toString(),
            encryptionMasterKeyBase64: 'nxzvbGF+f8FGhk/jOaZvgMle1tqxzF/VfUZLBLhhaH0=',
        });
    }

    static newClientForPrivateChannel(clientOptions = {}, port = 6001, key = 'app-key', userData = {}): any {
        return this.newClient({
            authorizer: (channel, options) => ({
                authorize: (socketId, callback) => {
                    callback(null, {
                        auth: this.signTokenForPrivateChannel(socketId, channel),
                    });
                },
            }),
            userAuthentication: {
                customHandler: ({ socketId }, callback) => {
                    callback(null, {
                        auth: this.signTokenForUserAuthentication(socketId, JSON.stringify(userData), key),
                        user_data: JSON.stringify(userData),
                    });
                },
                transport: 'ajax',
                endpoint: '/',
            },
            ...clientOptions,
        }, port, key);
    }

    static newClientForEncryptedPrivateChannel(clientOptions = {}, port = 6001, key = 'app-key', userData = {}): any {
        return this.newClient({
            authorizer: (channel, options) => ({
                authorize: (socketId, callback) => {
                    callback(null, {
                        auth: this.signTokenForPrivateChannel(socketId, channel, key),
                        shared_secret: this.newBackend().channelSharedSecret(channel.name).toString('base64'),
                    });
                },
            }),
            userAuthentication: {
                customHandler: ({ socketId }, callback) => {
                    callback(null, {
                        auth: this.signTokenForUserAuthentication(socketId, JSON.stringify(userData), key),
                        user_data: JSON.stringify(userData),
                    });
                },
                transport: 'ajax',
                endpoint: '/',
            },
            ...clientOptions,
        }, port, key);
    }

    static newClientForPresenceUser(user: any, clientOptions = {}, port = 6001, key = 'app-key', userData = {}): any {
        return this.newClient({
            authorizer: (channel, options) => ({
                authorize: (socketId, callback) => {
                    callback(null, {
                        auth: this.signTokenForPresenceChannel(socketId, channel, user, key),
                        channel_data: JSON.stringify(user),
                    });
                },
            }),
            userAuthentication: {
                customHandler: ({ socketId }, callback) => {
                    callback(null, {
                        auth: this.signTokenForUserAuthentication(socketId, JSON.stringify(userData), key),
                        user_data: JSON.stringify(userData),
                    });
                },
                transport: 'ajax',
                endpoint: '/',
            },
            ...clientOptions,
        }, port, key);
    }

    static signTokenForPrivateChannel(
        socketId: string,
        channel: any,
        key = 'app-key',
        secret = 'app-secret'
    ): string {
        let token = (Pusher as any).Token(key, secret);
        return key + ':' + token.sign(`${socketId}:${channel.name}`);
    }

    static signTokenForPresenceChannel(
        socketId: string,
        channel: any,
        channelData: any,
        key = 'app-key',
        secret = 'app-secret'
    ): string {
        let token = (Pusher as any).Token(key, secret);
        return key + ':' + token.sign(`${socketId}:${channel.name}:${JSON.stringify(channelData)}`);
    }

    static signTokenForUserAuthentication(
        socketId: string,
        userData: string,
        key = 'app-key',
        secret = 'app-secret'
    ): string {
        let token = new (Pusher as any).Token(key, secret);
        return key + ':' + token.sign(`${socketId}::user::${userData}`);
    }

    static async wait(ms): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static randomChannelName(): string {
        return `channel-${Math.floor(Math.random() * 10000000)}`;
    }

    static shouldRun(conditions: ShouldRunConditions): jest.It {
        if (conditions.appManager && conditions.appManager !== process.env.TEST_APP_MANAGER) {
            return it.skip;
        }

        if (conditions.queueManager && conditions.queueManager !== process.env.TEST_QUEUE_DRIVER) {
            return it.skip;
        }

        return it;
    }
}
