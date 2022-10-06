import { CacheManagerInterface } from './cache-manager-interface';
import { Options } from '../options';

interface Memory {
    [key: string]: {
        value: any;
        ttlSeconds: number;
        setTime: number;
    };
}

export class MemoryCacheManager implements CacheManagerInterface {
    protected memory: Memory = {
        //
    };

    constructor(protected options: Options) {
        setInterval(() => {
            for (let [key, { ttlSeconds, setTime }] of Object.entries(this.memory)) {
                let currentTime = parseInt((new Date().getTime() / 1000) as unknown as string);

                if (ttlSeconds > 0 && (setTime + ttlSeconds) <= currentTime) {
                    delete this.memory[key];
                }
            }
        }, 1_000);
    }

    async has(key: string): Promise<boolean> {
        return typeof this.memory[key] !== 'undefined'
            ? Boolean(this.memory[key])
            : false;
    }

    async get(key: string): Promise<any> {
        return await this.has(key)
            ? this.memory[key].value
            : null;
    }

    async set(key: string, value: any, ttlSeconds = -1): Promise<any> {
        this.memory[key] = {
            value,
            ttlSeconds,
            setTime: parseInt((new Date().getTime() / 1000) as unknown as string),
        };

        return true;
    }

    async disconnect(): Promise<void> {
        this.memory = {};

        return Promise.resolve();
    }
}
