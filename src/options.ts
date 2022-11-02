import { AppInterface } from './app-managers/app';
import { ConsumerOptions } from '@rxfork/sqs-consumer';
import { SQSClientConfig } from '@aws-sdk/client-sqs';

export interface Options {
    cors: {
        credentials: boolean;
        origin: string[];
        methods: string[];
        allowedHeaders: string[];
    };
    logs: {
        verbose: boolean;
        showWarnings: boolean;
        timestamps: boolean;
    };
    metrics: {
        enabled: boolean;
        server: {
            host: string;
            port: number;
        };
    };
    peer: {
        discovery: {
            host: string;
        };
        mdns: {
            server: {
                host: string;
                port: number;
                tag: string;
            };
        };
        ws: {
            enabled: boolean;
            port: number;
        };
        inactivityTimeout: number;
    },
    websockets: {
        appManagers: {
            cache: {
                enabled: boolean;
                ttl: number;
            };
            driver: 'array'|'dynamodb';
            drivers: {
                array: {
                    apps: AppInterface[];
                };
                dynamodb: {
                    table: string;
                    region: string;
                    endpoint?: string;
                };
            };
        };
        cacheManagers: {
            driver: 'memory';
        };
        http: {
            acceptTraffic: {
                memoryThreshold: number;
            };
            maxPayloadSizeInMb: number;
        };
        limits: {
            channels: {
                maxNameLength: number;
                cacheTtl: number;
            };
            events: {
                maxChannelsAtOnce: number;
                maxNameLength: number;
                maxPayloadInKb: number;
                maxBatchSize: number;
            };
            presence: {
                maxMembersPerChannel: number;
                maxMemberSizeInKb: number;
            };
        };
        mode: 'full'|'server'|'worker',
        queueManagers: {
            driver: 'sync'|'sqs';
            sqs: {
                region?: string;
                endpoint?: string;
                clientOptions?: SQSClientConfig;
                consumerOptions?: ConsumerOptions;
                url: string;
                processBatch: boolean;
                batchSize: number;
                pollingWaitTimeMs: number;
            },
        };
        rateLimiters: {
            driver: 'local';
        };
        server: {
            host: string;
            port: number;
            gracePeriod: number;
            maxBackpressureInMb: number;
            maxPayloadLengthInMb: number;
        };
        webhooks: {
            batching: {
                enabled: boolean;
                duration: number;
            };
        };
    };
}
