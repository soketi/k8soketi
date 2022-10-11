import { AppInterface } from "./app-managers/app";

export interface Options {
    cors: {
        credentials: boolean;
        origin: string[];
        methods: string[];
        allowedHeaders: string[];
    };
    logs: {
        verbose: boolean;
        timestamps: boolean;
    };
    metrics: {
        enabled: boolean;
        server: {
            host: string;
            port: number;
        };
    };
    websockets: {
        appManagers: {
            cache: {
                enabled: boolean;
                ttl: number;
            };
            driver: string;
            drivers: {
                array: {
                    apps: AppInterface[];
                };
            };
        };
        cache: {
            driver: string;
        };
        dns: {
            discovery: {
                host: string;
                port: number;
            };
            server: {
                host: string;
                port: number;
            };
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
        rateLimiters: {
            driver: string;
        };
        server: {
            host: string;
            port: number;
        };
    };
}
