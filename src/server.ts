import * as dot from 'dot-wild';
import { Log } from './log';
import { MetricsNode } from './metricsNode';
import { Options } from './options';
import { PeerNode } from './peerNode';
import { WebsocketsNode } from './websocketsNode';

export default class Server {
    peerNode: PeerNode;
    websocketsNode: WebsocketsNode;
    metricsNode: MetricsNode;

    options: Options = {
        cors: {
            credentials: true,
            origin: ['*'],
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: [
                'Origin',
                'Content-Type',
                'X-Auth-Token',
                'X-Requested-With',
                'Accept',
                'Authorization',
                'X-CSRF-TOKEN',
                'XSRF-TOKEN',
                'X-Socket-Id',
            ],
        },
        logs: {
            verbose: false,
            timestamps: false,
            showWarnings: false,
        },
        metrics: {
            enabled: false,
            server: {
                host: '127.0.0.1',
                port: 9601,
            },
        },
        peer: {
            dns: {
                discovery: {
                    host: '127.0.0.1',
                },
                server: {
                    host: '127.0.0.1',
                    port: 53,
                    tag: 'ipfs.local',
                },
            },
            inactivityTimeout: 10,
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
                    dynamodb: {
                        table: '',
                        region: 'us-east-1',
                        endpoint: null,
                    },
                },
            },
            cacheManagers: {
                driver: 'memory',
            },
            http: {
                acceptTraffic: {
                    memoryThreshold: 90,
                },
                maxPayloadSizeInMb: 100,
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
            queueManagers: {
                driver: 'sync',
                sqs: {
                    region: 'us-east-1',
                    endpoint: null,
                    clientOptions: {},
                    consumerOptions: {},
                    url: '',
                    processBatch: false,
                    batchSize: 1,
                    pollingWaitTimeMs: 0,
                },
            },
            rateLimiters: {
                driver: 'local',
            },
            server: {
                host: '0.0.0.0',
                port: 6001,
                gracePeriod: 1,
                maxBackpressureInMb: 1,
                maxPayloadLengthInMb: 100,
            },
            webhooks: {
                batching: {
                    enabled: false,
                    duration: 1e3,
                },
            },
        },
    };

    constructor(optionsOverrides: { [key: string]: any; } = {}, public cli = false) {
        this.overrideOptions(optionsOverrides);

        this.peerNode = new PeerNode(this.options);
        this.websocketsNode = new WebsocketsNode(this.options);
        this.metricsNode = new MetricsNode(this.options);

        if (this.options.logs.verbose) {
            Log.enableVerbosity();

            if (this.options.logs.timestamps) {
                Log.enableTimestamps();
            }
        }

        Log.showWarnings = this.options.logs.showWarnings;
    }

    async start(): Promise<void> {
        Log.info('🤖 Initializing the peer node...', true);
        await this.peerNode.initialize();

        Log.info('🤖 Initializing the WebSockets server...', true);
        await this.websocketsNode.initialize(this.peerNode);

        if (this.options.metrics.enabled) {
            Log.info('📈 Initializing the Metrics server...', true);
            await this.metricsNode.initialize(this.peerNode, this.websocketsNode);
        }

        // Register the exit handlers before the starts occur.
        await this.registerExitHandlers();

        Log.info('🐝 Starting the peer node...', true);
        await this.peerNode.start();

        Log.info('🐝 Starting the WebSockets server...', true);
        await this.websocketsNode.start();

        if (this.options.metrics.enabled) {
            Log.info('🐝 Starting the Metrics server...', true);
            await this.metricsNode.start();
        }

        Log.info('👍 The node is now operating!', true);
    }

    async stop(): Promise<void> {
        Log.info('🛑 Closing the peer node...', true);
        await this.peerNode.stop();

        Log.info('🛑 Closing the WebSockets server...', true);
        await this.websocketsNode.stop();

        if (this.options.metrics.enabled) {
            Log.info('🛑 Closing the Metrics server...', true);
            await this.metricsNode.stop();
        }
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
