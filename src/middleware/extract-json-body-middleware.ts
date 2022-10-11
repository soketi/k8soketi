import { Log } from '../log';
import { HttpResponse, HttpUtils } from '../utils/http-utils';
import { MiddlewareClass } from './middleware-class';

export class ExtractJsonBodyMiddleware extends MiddlewareClass {
    async handle(res: HttpResponse): Promise<HttpResponse> {
        try {
            let [body, rawBody] = await this.readJson(res);

            res.body = body;
            res.rawBody = rawBody;
        } catch (e) {
            Log.error(`[HTTP API][IP: ${res.ip}] Failed to extract JSON: ${e}`);
            return HttpUtils.badResponse(res, 'The body is not JSON-encoded.');
        }

        let maxPayloadSizeInMb = this.wsNode.options.websockets.http.maxPayloadSizeInMb;

        if (maxPayloadSizeInMb) {
            return HttpUtils.entityTooLargeResponse(res, `The request cannot be greater than ${maxPayloadSizeInMb}MB.`);
        }

        return res;
    }

    protected async readJson(res: HttpResponse): Promise<[{ [key: string]: any; }, string]> {
        let buffer;

        return new Promise((resolve, reject) => {
            res.onData((ab, isLast) => {
                let chunk = Buffer.from(ab);

                if (isLast) {
                    let json = {};
                    let raw = '{}';

                    if (buffer) {
                        try {
                            // @ts-ignore
                            json = JSON.parse(Buffer.concat([buffer, chunk]));
                        } catch (e) { }

                        try {
                            raw = Buffer.concat([buffer, chunk]).toString();
                        } catch (e) { }

                        resolve([json, raw]);
                    } else {
                        try {
                            // @ts-ignore
                            json = JSON.parse(chunk);
                            raw = chunk.toString();
                        } catch (e) {
                            //
                        }

                        resolve([json, raw]);
                    }
                } else {
                    buffer = buffer
                        ? Buffer.concat([buffer, chunk])
                        : Buffer.concat([chunk]);
                }
            });

            res.onAborted(() => reject());
        });
    }
}
