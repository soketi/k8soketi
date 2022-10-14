import { App } from './app';
import { AppManagerInterface } from './app-manager-interface';
import { ArrayAppManager } from './array-app-manager';
import { CacheManager } from '../cache-managers/cache-manager';
import { DynamoDbAppManager } from './dynamodb-app-manager';
import { Log } from '../log';
import { Options } from '../options';

export class AppManager {
    static driver: AppManagerInterface;
    static options: Options;

    static async initialize(options: Options): Promise<void> {
        this.options = options;

        if (options.websockets.appManagers.driver === 'array') {
            this.driver = new ArrayAppManager(options);
            Log.info('[App Manager] App Manager: Array');
        } else if (options.websockets.appManagers.driver === 'dynamodb') {
            this.driver = new DynamoDbAppManager(options);
            Log.info('[App Manager] App Manager: AWS DynamoDB');
        } else {
            Log.error('[App Manager] The App Manager driver was not initialized.');
        }
    }

    static async findById(id: string): Promise<App|null> {
        if (!this.options.websockets.appManagers.cache.enabled) {
            return this.driver.findById(id);
        }

        let appFromCache = await CacheManager.get(`app:${id}`);

        if (appFromCache) {
            return new App(JSON.parse(appFromCache), this.options);
        }

        let app = await this.driver.findById(id);

        await CacheManager.set(
            `app:${id}`,
            app ? app.toJson() : app,
            this.options.websockets.appManagers.cache.ttl,
        );

        return app;
    }

    static async findByKey(key: string): Promise<App|null> {
        if (!this.options.websockets.appManagers.cache.enabled) {
            return this.driver.findByKey(key);
        }

        let appFromCache = await CacheManager.get(`app:${key}`);

        if (appFromCache) {
            return new App(JSON.parse(appFromCache), this.options);
        }

        let app = await this.driver.findByKey(key);

        await CacheManager.set(
            `app:${key}`,
            app ? app.toJson() : app,
            this.options.websockets.appManagers.cache.ttl,
        );

        return app;
    }

    static async getAppSecret(id: string): Promise<string|null> {
        return this.driver.getAppSecret(id);
    }
}
