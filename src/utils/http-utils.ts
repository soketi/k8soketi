import ab2str from 'arraybuffer-to-string';
import { App } from '../app-managers/app';
import { HttpRequest, HttpResponse as BaseHttpResponse, RecognizedString } from 'uWebSockets.js';
import { Log } from '../log';
import { MiddlewareClass } from '../middleware/middleware-class';
import queryString from 'query-string';

export interface HttpResponse extends BaseHttpResponse {
    ip?: string;
    body?: { [key: string]: any; };
    rawBody?: string;
    query?: {
        auth_signature?: string;
        [key: string]: any;
    };
    params?: {
        appId?: string;
        [key: string]: any;
    };
    method?: string;
    url?: string;
    app?: App;
}

export class HttpUtils {
    static async initialize(res: HttpResponse): Promise<HttpResponse> {
        res.ip = ab2str(res.getRemoteAddressAsText());

        res.onAborted(() => {
            Log.warning(`[HTTP][IP: ${res.ip}] Request aborted.`);
        });

        return res;
    }

    static async applyMiddleware(res: HttpResponse, middleware: MiddlewareClass[]): Promise<HttpResponse> {
        try {
            for await (let m of middleware) {
                res = await m.handle(res);
            }
        } catch (e) {
            Log.warning(`[HTTP][IP: ${res.ip}] Middleware failed to apply: ${e}`);
            return this.serverErrorResponse(res, 'A server error has occured.');
        }

        return res;
    }

    static async extractRequestDetails(res: HttpResponse, req: HttpRequest, namedParams: string[] = []): Promise<HttpResponse> {
        if (namedParams.length > 0) {
            for await (let [index, paramName] of namedParams.entries()) {
                res.params[paramName] = req.getParameter(index);
            }
        }

        res.query = queryString.parse(req.getQuery());
        res.method = req.getMethod().toUpperCase();
        res.url = req.getUrl();

        return res;
    }

    static async sendJson(res: HttpResponse, data: any, status: RecognizedString = '200 OK'): Promise<HttpResponse> {
        try {
            return res.writeStatus(status)
                .writeHeader('Content-Type', 'application/json')
                .end(JSON.stringify(data), true);
        } catch (e) {
            Log.warning(`[HTTP][IP: ${res.ip}] JSON Response could not be sent: ${e}`);
            return res;
        }
    }

    static async send(res: HttpResponse, data: RecognizedString, status: RecognizedString = '200 OK'): Promise<HttpResponse> {
        try {
            return res.writeStatus(status).end(data, true);
        } catch (e) {
            Log.warning(`[HTTP][IP: ${res.ip}] Response could not be sent: ${e}`);
            return res;
        }
    }

    static async badResponse(res: HttpResponse, error: string): Promise<HttpResponse> {
        return this.sendJson(res, { error, code: 400 }, '400 Invalid Request');
    }

    static async notFoundResponse(res: HttpResponse, error: string): Promise<HttpResponse> {
        return this.sendJson(res, { error, code: 404 }, '404 Not Found');
    }

    static async unauthorizedResponse(res: HttpResponse, error: string): Promise<HttpResponse> {
        return this.sendJson(res, { error, code: 401 }, '401 Authorization Required');
    }

    static async entityTooLargeResponse(res: HttpResponse, error: string): Promise<HttpResponse> {
        return this.sendJson(res, { error, code: 413 }, '413 Payload Too Large');
    }

    static async tooManyRequestsResponse(res: HttpResponse): Promise<HttpResponse> {
        return this.sendJson(res, { error: 'Too many requests.', code: 429 }, '429 Too Many Requests');
    }

    static async serverErrorResponse(res: HttpResponse, error: string): Promise<HttpResponse> {
        return this.sendJson(res, { error, code: 500 }, '500 Internal Server Error');
    }

    static async getSignedToken(res: HttpResponse): Promise<string> {
        return res.app.signingTokenFromRequest(res);
    }

    static async signatureIsValid(res: HttpResponse): Promise<boolean> {
        return (await this.getSignedToken(res)) === res.query.auth_signature;
    }
}
