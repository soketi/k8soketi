import * as dot from 'dot-wild';
import { Log } from './log';
import { Options } from './options';
import { PeerNode } from './peerNode';
import { WebsocketsNode } from './websocketsNode';

export default class Server {
    peerNode: PeerNode;
    websocketsNode: WebsocketsNode;

    protected options: Options = {
        logs: {
            verbose: false,
            timestamps: false,
        },
        websockets: {
            appManagers: {
                cache: {
                    enabled: false,
                    ttl: -1,
                },
                driver: 'array',
                drivers: {
                    array: {
                        apps: [
                            {
                                id: 'app-id',
                                key: 'app-key',
                                secret: 'app-secret',
                                maxConnections: -1,
                                enableClientMessages: false,
                                enabled: true,
                                webhooks: [],
                                maxBackendEventsPerSecond: -1,
                                maxClientEventsPerSecond: -1,
                                maxReadRequestsPerSecond: -1,
                            },
                        ],
                    },
                },
            },
            cache: {
                driver: 'memory',
            },
            limits: {
                channels: {
                    maxNameLength: 200,
                    cacheTtl: 3600,
                },
                events: {
                    maxChannelsAtOnce: 100,
                    maxNameLength: 200,
                    maxPayloadInKb: 100,
                    maxBatchSize: 10,
                },
                presence: {
                    maxMembersPerChannel: 100,
                    maxMemberSizeInKb: 2,
                },
            },
            server: {
                host: '0.0.0.0',
                port: 6001,
            },
        },
    };

    constructor(optionsOverrides: { [key: string]: any; } = {}, public cli = false) {
        this.overrideOptions(optionsOverrides);

        this.peerNode = new PeerNode(this.options);
        this.websocketsNode = new WebsocketsNode(this.options);

        if (this.options.logs.verbose) {
            Log.enableVerbosity();

            if (this.options.logs.timestamps) {
                Log.enableTimestamps();
            }
        }
    }

    async start(): Promise<void> {
        Log.info('🤖 Initializing the peer node...', true);
        await this.peerNode.initialize();

        Log.info('🤖 Initializing the WebSockets node...', true);
        await this.websocketsNode.initialize(this.peerNode);

        // Register the exit handlers before the starts occur.
        await this.registerExitHandlers();

        Log.info('🐝 Starting the peer node...', true);
        await this.peerNode.start();

        Log.info('🐝 Starting the WebSockets node...', true);
        await this.websocketsNode.start();

        Log.success('👍 The node is now operating!', true);
    }

    async stop(): Promise<void> {
        Log.info('🛑 Closing the peer node...', true);
        await this.peerNode.stop();

        Log.info('🛑 Closing the WebSockets node...', true);
        await this.websocketsNode.stop();
    }

    protected overrideOptions(optionsOverrides: { [key: string]: any; }): void {
        for (let key in optionsOverrides) {
            this.options = dot.set(this.options, key, optionsOverrides[key]);
        }
    }

    protected async registerExitHandlers(): Promise<void> {
        if (!this.cli) {
            return;
        }

        const handleFailure = async () => {
            await this.stop();
            process.exit();
        };

        process.on('SIGINT', handleFailure);
        process.on('SIGHUP', handleFailure);
        process.on('SIGTERM', handleFailure);
    }
}
