import { HttpResponse, HttpUtils } from '../utils/http-utils';
import { MiddlewareClass } from './middleware-class';

export class AppAuthenticationMiddleware extends MiddlewareClass {
    async handle(res: HttpResponse): Promise<HttpResponse> {
        let signatureIsValid = await HttpUtils.signatureIsValid(res);

        if (!signatureIsValid) {
            return HttpUtils.unauthorizedResponse(res, 'Signature is not valid.');
        }

        return res;
    }
}
