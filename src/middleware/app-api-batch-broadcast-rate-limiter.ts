import { AppApiRateLimiter } from './app-api-rate-limiter';
import { ConsumptionResponse } from '../rate-limiters/rate-limiter-interface';
import { HttpResponse } from '../utils/http-utils';
import { RateLimiter } from '../rate-limiters/rate-limiter';

export class AppApiBatchBroadcastRateLimiter extends AppApiRateLimiter {
    async consumePoints(res: HttpResponse): Promise<ConsumptionResponse> {
        let rateLimiterPoints = res.body.batch.reduce((rateLimiterPoints, event) => {
            let channels: string[] = event.channels || [event.channel];
            return rateLimiterPoints += channels.length;
        }, 0);

        return RateLimiter.consumeReadRequestsPoints(rateLimiterPoints, res.app);
    }
}
