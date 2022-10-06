import { AppInterface } from "./app-managers/app";

export interface Options {
    logs: {
        verbose: boolean;
        timestamps: boolean;
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
        server: {
            host: string;
            port: number;
        };
    };
}
