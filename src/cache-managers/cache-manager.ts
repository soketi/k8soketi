import { CacheManagerInterface } from './cache-manager-interface';
import { Log } from '../log';
import { MemoryCacheManager } from './memory-cache-manager';
import { Options } from '../options';

export class CacheManager {
    static driver: CacheManagerInterface;
    static options: Options;

    static async initialize(options: Options) {
        this.options = options;

        if (options.websockets.cacheManagers.driver === 'memory') {
            this.driver = new MemoryCacheManager(options);
            Log.info('[Cache] Cache driver: memory');
        } else {
            Log.error('[Cache] Cache driver was not initialized.');
        }
    }

    static async has(key: string): Promise<boolean> {
        return this.driver.has(key);
    }

    static async get(key: string): Promise<any> {
        return this.driver.get(key);
    }

    static async set(key: string, value: any, ttlSeconds: number): Promise<any> {
        return this.driver.set(key, value, ttlSeconds);
    }

    static async disconnect(): Promise<void> {
        return this.driver.disconnect();
    }
}
