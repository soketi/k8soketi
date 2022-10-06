import { CacheManagerInterface } from './cache-manager-interface';
import { Log } from '../log';
import { MemoryCacheManager } from './memory-cache-manager';
import { Options } from '../options';

export class CacheManager implements CacheManagerInterface {
    driver: CacheManagerInterface;

    constructor(protected options: Options) {
        if (options.websockets.cache.driver === 'memory') {
            this.driver = new MemoryCacheManager(options);
        } else {
            Log.error('[Cache Manager] Cache driver was not initialized.');
        }
    }

    has(key: string): Promise<boolean> {
        return this.driver.has(key);
    }

    get(key: string): Promise<any> {
        return this.driver.get(key);
    }

    set(key: string, value: any, ttlSeconds: number): Promise<any> {
        return this.driver.set(key, value, ttlSeconds);
    }

    disconnect(): Promise<void> {
        return this.driver.disconnect();
    }
}
