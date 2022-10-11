import { AppApiRateLimiter } from './app-api-rate-limiter';
import { ConsumptionResponse } from '../rate-limiters/rate-limiter-interface';
import { HttpResponse } from '../utils/http-utils';
import { RateLimiter } from '../rate-limiters/rate-limiter';

export class AppApiBroadcastRateLimiter extends AppApiRateLimiter {
    async consumePoints(res: HttpResponse): Promise<ConsumptionResponse> {
        let channels = res.body.channels || [res.body.channel];

        return RateLimiter.consumeReadRequestsPoints(Math.max(channels.length, 1), res.app);
    }
}
