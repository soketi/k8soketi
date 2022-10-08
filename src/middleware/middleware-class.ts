import { WebsocketsNode } from '../websocketsNode';
import { HttpResponse } from './../utils/http-utils';

export abstract class MiddlewareClass {
    constructor(protected wsNode: WebsocketsNode) {
        //
    }

    abstract handle(res: HttpResponse): Promise<HttpResponse>;
}
