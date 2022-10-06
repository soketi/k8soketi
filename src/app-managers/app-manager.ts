import { App } from './app';
import { AppManagerInterface } from './app-manager-interface';
import { ArrayAppManager } from './array-app-manager';
import { CacheManager } from '../cache-managers/cache-manager';
import { Log } from '../log';
import { Options } from '../options';

export class AppManager implements AppManagerInterface {
    driver: AppManagerInterface;

    constructor(protected options: Options, public cacheManager: CacheManager) {
        if (options.websockets.appManagers.driver === 'array') {
            this.driver = new ArrayAppManager(options);
        } else {
            Log.error('[App Manager] The App Manager driver was not initialized.');
        }
    }

    async findById(id: string): Promise<App|null> {
        if (!this.options.websockets.appManagers.cache.enabled) {
            return this.driver.findById(id);
        }

        let appFromCache = await this.cacheManager.get(`app:${id}`);

        if (appFromCache) {
            return new App(JSON.parse(appFromCache), this.options);
        }

        let app = await this.driver.findById(id);

        await this.cacheManager.set(
            `app:${id}`,
            app ? app.toJson() : app,
            this.options.websockets.appManagers.cache.ttl,
        );

        return app;
    }

    async findByKey(key: string): Promise<App|null> {
        if (!this.options.websockets.appManagers.cache.enabled) {
            return this.driver.findByKey(key);
        }

        let appFromCache = await this.cacheManager.get(`app:${key}`);

        if (appFromCache) {
            return new App(JSON.parse(appFromCache), this.options);
        }

        let app = await this.driver.findByKey(key);

        await this.cacheManager.set(
            `app:${key}`,
            app ? app.toJson() : app,
            this.options.websockets.appManagers.cache.ttl,
        );

        return app;
    }

    async getAppSecret(id: string): Promise<string|null> {
        return this.driver.getAppSecret(id);
    }
}
