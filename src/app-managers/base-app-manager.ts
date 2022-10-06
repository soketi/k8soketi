import { App } from './app';
import { AppManagerInterface } from './app-manager-interface';

export class BaseAppManager implements AppManagerInterface {
    async findById(id: string): Promise<App|null> {
        return null;
    }

    async findByKey(key: string): Promise<App|null> {
        return null;
    }

    async getAppSecret(id: string): Promise<string|null> {
        let app = await this.findById(id);

        return app ? app.secret : null;
    }
}
