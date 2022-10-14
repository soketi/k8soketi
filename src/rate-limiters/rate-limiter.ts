import { App } from './../app-managers/app';
import { ConsumptionResponse, RateLimiterInterface } from './rate-limiter-interface';
import { LocalRateLimiter } from './local-rate-limiter';
import { Log } from './../log';
import { Options } from '../options';
import { RateLimiterAbstract } from 'rate-limiter-flexible';
import { WebSocket } from '../websocket';

export class RateLimiter {
    static driver: RateLimiterInterface;

    static async initialize(options: Options) {
        if (options.websockets.rateLimiters.driver === 'local') {
            this.driver = new LocalRateLimiter(options);
            Log.info('[Rate Limiter] Rate Limiter driver: local');
        } else {
            Log.error('[Rate Limiter] Rate Limiter driver was not initialized.');
        }
    }

    static async consumeBackendEventPoints(points: number, app?: App, ws?: WebSocket): Promise<ConsumptionResponse> {
        return this.driver.consumeBackendEventPoints(points, app, ws);
    }

    static async consumeFrontendEventPoints(points: number, app?: App, ws?: WebSocket): Promise<ConsumptionResponse> {
        return this.driver.consumeFrontendEventPoints(points, app, ws);
    }

    static async consumeReadRequestsPoints(points: number, app?: App, ws?: WebSocket): Promise<ConsumptionResponse> {
        return this.driver.consumeReadRequestsPoints(points, app, ws);
    }

    static async createNewRateLimiter(appId: string, maxPoints: number): Promise<RateLimiterAbstract> {
        return this.driver.createNewRateLimiter(appId, maxPoints);
    }

    // TODO: Call this function
    static async disconnect(): Promise<void> {
        return this.driver.disconnect();
    }
}
