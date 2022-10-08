import { HttpResponse, HttpUtils } from '../utils/http-utils';
import { MiddlewareClass } from './middleware-class';

export class AppRetrievalMiddleware extends MiddlewareClass {
    async handle(res: HttpResponse): Promise<HttpResponse> {
        let app = await this.wsNode.appManager.findById(res.params.appId);

        if (!app) {
            return HttpUtils.notFoundResponse(res, 'The app does not exist.');
        }

        res.app = app;

        return res;
    }
}
