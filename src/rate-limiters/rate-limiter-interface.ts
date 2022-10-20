import { App } from './../app-managers/app';
import { RateLimiterAbstract, RateLimiterRes } from 'rate-limiter-flexible';
import { WebSocket } from 'uWebSockets.js';

export interface ConsumptionResponseHeaders {
    'Retry-After'?: number;
    'X-RateLimit-Limit'?: number;
    'X-RateLimit-Remaining'?: number;
};

export interface ConsumptionResponse {
    canContinue: boolean;
    rateLimiterRes: RateLimiterRes|null;
    headers: ConsumptionResponseHeaders;
}

export interface RateLimiterInterface {
    driver?: RateLimiterInterface;

    consumeBackendEventPoints(points: number, app?: App, ws?: WebSocket): Promise<ConsumptionResponse>;
    consumeFrontendEventPoints(points: number, app?: App, ws?: WebSocket): Promise<ConsumptionResponse>;
    consumeReadRequestsPoints(points: number, app?: App, ws?: WebSocket): Promise<ConsumptionResponse>;
    createNewRateLimiter(appId: string, maxPoints: number): RateLimiterAbstract;
    disconnect(): Promise<void>;
}
