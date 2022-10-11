import { RateLimiter } from '../rate-limiters/rate-limiter';
import { ConsumptionResponse } from '../rate-limiters/rate-limiter-interface';
import { HttpResponse, HttpUtils } from '../utils/http-utils';
import { MiddlewareClass } from './middleware-class';

export abstract class AppApiRateLimiter extends MiddlewareClass {
    async handle(res: HttpResponse): Promise<HttpResponse> {
        let response = await this.consumePoints(res);

        for (let header in response.headers) {
            res.writeHeader(header, '' + response.headers[header]);
        }

        if (!response.canContinue) {
            return await HttpUtils.tooManyRequestsResponse(res);
        }

        return res;
    }

    abstract consumePoints(res: HttpResponse): Promise<ConsumptionResponse>;
}
