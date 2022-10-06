export interface CacheManagerInterface {
    driver?: CacheManagerInterface;

    has(key: string): Promise<boolean>;
    get(key: string): Promise<any>;
    set(key: string, value: any, ttlSeconds: number): Promise<any>;
    disconnect(): Promise<void>;
}
