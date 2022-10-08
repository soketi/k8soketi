import { HttpResponse, HttpUtils } from '../utils/http-utils';
import { MiddlewareClass } from './middleware-class';

export class InitializeResponseMiddleware extends MiddlewareClass {
    async handle(res: HttpResponse): Promise<HttpResponse> {
        return await HttpUtils.initialize(res);
    }
}
