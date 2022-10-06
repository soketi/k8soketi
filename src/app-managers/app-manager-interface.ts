import { App } from './app';

export interface AppManagerInterface {
    driver?: AppManagerInterface;

    findById(id: string): Promise<App|null>;
    findByKey(key: string): Promise<App|null>;
    getAppSecret(id: string): Promise<string|null>;
}
