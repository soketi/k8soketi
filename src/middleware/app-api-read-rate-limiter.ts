import { AppApiRateLimiter } from './app-api-rate-limiter';
import { ConsumptionResponse } from '../rate-limiters/rate-limiter-interface';
import { HttpResponse } from '../utils/http-utils';
import { RateLimiter } from '../rate-limiters/rate-limiter';

export class AppApiReadRateLimiter extends AppApiRateLimiter {
    async consumePoints(res: HttpResponse): Promise<ConsumptionResponse> {
        return RateLimiter.consumeReadRequestsPoints(1, res.app);
    }
}
