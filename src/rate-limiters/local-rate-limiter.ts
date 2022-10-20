import { App } from './../app-managers/app';
import { ConsumptionResponse, ConsumptionResponseHeaders, RateLimiterInterface } from './rate-limiter-interface';
import { Options } from '../options';
import { RateLimiterAbstract, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { WebSocket } from '../websocket';

export class LocalRateLimiter implements RateLimiterInterface {
    protected rateLimiters: { [appId: string]: RateLimiterAbstract } = {
        //
    };

    constructor(protected options: Options) {
        //
    }

    async consumeBackendEventPoints(points: number, app?: App, ws?: WebSocket): Promise<ConsumptionResponse> {
        return this.consume(
            app,
            `${app.id}:backend:events`,
            points,
            app.maxBackendEventsPerSecond as number,
        );
    }

    async consumeFrontendEventPoints(points: number, app?: App, ws?: WebSocket): Promise<ConsumptionResponse> {
        return this.consume(
            app,
            `${app.id}:frontend:events:${ws.id}`,
            points,
            app.maxClientEventsPerSecond as number,
        );
    }

    async consumeReadRequestsPoints(points: number, app?: App, ws?: WebSocket): Promise<ConsumptionResponse> {
        return this.consume(
            app,
            `${app.id}:backend:request_read`,
            points,
            app.maxReadRequestsPerSecond as number,
        );
    }

    createNewRateLimiter(appId: string, maxPoints: number): RateLimiterAbstract {
        return new RateLimiterMemory({
            points: maxPoints,
            duration: 1,
            keyPrefix: `app:${appId}`,
        });
    }

    async disconnect(): Promise<void> {
        this.rateLimiters = {};
    }

    protected async initializeRateLimiter(appId: string, eventKey: string, maxPoints: number): Promise<RateLimiterAbstract> {
        if (this.rateLimiters[`${appId}:${eventKey}`]) {
            this.rateLimiters[`${appId}:${eventKey}`].points = maxPoints;
            return this.rateLimiters[`${appId}:${eventKey}`];
        }

        this.rateLimiters[`${appId}:${eventKey}`] = this.createNewRateLimiter(appId, maxPoints);

        return this.rateLimiters[`${appId}:${eventKey}`];
    }

    protected async consume(app: App, eventKey: string, points: number, maxPoints: number): Promise<ConsumptionResponse> {
        if (maxPoints < 0) {
            return {
                canContinue: true,
                rateLimiterRes: null,
                headers: {
                    //
                },
            };
        }

        let rateLimiter = await this.initializeRateLimiter(app.id, eventKey, maxPoints);

        return rateLimiter.consume(eventKey, points).then((rateLimiterRes: RateLimiterRes) => {
            return {
                canContinue: true,
                rateLimiterRes,
                headers: this.calculateHeaders(rateLimiterRes, maxPoints),
            };
        }).catch((rateLimiterRes: RateLimiterRes) => {
            return {
                canContinue: false,
                rateLimiterRes,
                headers: this.calculateHeaders(rateLimiterRes, maxPoints),
            };
        });
    }

    protected calculateHeaders(rateLimiterRes: RateLimiterRes, maxPoints: number): ConsumptionResponseHeaders {
        return {
            'Retry-After': rateLimiterRes.msBeforeNext / 1000,
            'X-RateLimit-Limit': maxPoints,
            'X-RateLimit-Remaining': rateLimiterRes.remainingPoints,
        };
    }
}
