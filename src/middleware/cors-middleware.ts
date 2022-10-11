import { HttpResponse, HttpUtils } from '../utils/http-utils';
import { MiddlewareClass } from './middleware-class';

export class CorsMiddleware extends MiddlewareClass {
    async handle(res: HttpResponse): Promise<HttpResponse> {
        let cors = this.wsNode.options.cors;

        res.writeHeader('Access-Control-Allow-Origin', cors.origin.join(', '));
        res.writeHeader('Access-Control-Allow-Methods', cors.methods.join(', '));
        res.writeHeader('Access-Control-Allow-Headers', cors.allowedHeaders.join(', '));
        res.writeHeader('Access-Control-Allow-Credentials', cors.credentials ? 'true' : 'false');

        return res;
    }
}
