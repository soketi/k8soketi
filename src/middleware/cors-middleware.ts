import { HttpResponse, HttpUtils } from '../utils/http-utils';
import { MiddlewareClass } from './middleware-class';

export class CorsMiddleware extends MiddlewareClass {
    async handle(res: HttpResponse): Promise<HttpResponse> {
        // TODO: Custom CORS
        let cors = {
            credentials: true,
            origin: ['*'],
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: [
                'Origin',
                'Content-Type',
                'X-Auth-Token',
                'X-Requested-With',
                'Accept',
                'Authorization',
                'X-CSRF-TOKEN',
                'XSRF-TOKEN',
                'X-Socket-Id',
            ],
        };

        res.writeHeader('Access-Control-Allow-Origin', cors.origin.join(', '));
        res.writeHeader('Access-Control-Allow-Methods', cors.methods.join(', '));
        res.writeHeader('Access-Control-Allow-Headers', cors.allowedHeaders.join(', '));
        res.writeHeader('Access-Control-Allow-Credentials', cors.credentials ? 'true' : 'false');

        return res;
    }
}
