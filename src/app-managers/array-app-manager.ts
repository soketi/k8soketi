import { App } from './app';
import { BaseAppManager } from './base-app-manager';
import { Log } from '../log';
import { Options } from '../options';

export class ArrayAppManager extends BaseAppManager {
    constructor(protected options: Options) {
        super();
    }

    async findById(id: string): Promise<App|null> {
        let app = this.options.websockets.appManagers.drivers.array.apps.find(app => app.id == id);

        if (typeof app !== 'undefined') {
            return new App(app, this.options);
        }

        Log.info(`[App Manager] App with ID ${id} was not found.`);

        return null;
    }

    async findByKey(key: string): Promise<App|null> {
        let app = this.options.websockets.appManagers.drivers.array.apps.find(app => app.key == key);

        if (typeof app !== 'undefined') {
            return new App(app, this.options);
        }

        Log.info(`[App Manager] App with key ${key} was not found.`);

        return null;
    }
}
