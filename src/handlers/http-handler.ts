import { CorsMiddleware } from '../middleware/cors-middleware';
import { InitializeResponseMiddleware } from '../middleware/initialize-response-middleware';
import { HttpRequest } from 'uWebSockets.js';
import { HttpResponse, HttpUtils } from '../utils/http-utils';
import { MiddlewareClass } from '../middleware/middleware-class';
import { WebsocketsNode } from '../websocketsNode';

export class HttpHandler {
    static wsNode: WebsocketsNode;

    static async serve(fn: string, res: HttpResponse, req: HttpRequest, middleware: MiddlewareClass[] = [], namedParams: string[] = []): Promise<HttpResponse> {
        await HttpUtils.applyMiddleware(res, [
            new InitializeResponseMiddleware(this.wsNode),
            new CorsMiddleware(this.wsNode),
        ]);

        await HttpUtils.extractRequestDetails(res, req, namedParams);
        await HttpUtils.applyMiddleware(res, middleware);

        return this[fn](res, middleware);
    }

    static async notFound(res: HttpResponse): Promise<HttpResponse> {
        return HttpUtils.send(res, '', '404 Not Found');
    }
}
