import { HttpHandler } from './http-handler';
import { HttpResponse, HttpUtils } from '../utils/http-utils';
import { Prometheus } from '../prometheus';
import v8 from 'v8';

export class MetricsHttpApiHandler extends HttpHandler {
    static async healthCheck(res: HttpResponse): Promise<HttpResponse> {
        return HttpUtils.send(res, 'OK');
    }

    static async prometheusMetrics(res: HttpResponse): Promise<HttpResponse> {
        if (res.query.json) {
            return HttpUtils.sendJson(res, await Prometheus.registry.getMetricsAsJSON());
        }

        return HttpUtils.send(res, await Prometheus.registry.metrics());
    }

    static async memoryMetrics(res: HttpResponse): Promise<HttpResponse> {
        let {
            rss,
            heapTotal,
            external,
            arrayBuffers,
        } = process.memoryUsage();

        let totalSize = v8.getHeapStatistics().total_available_size;
        let usedSize = rss + heapTotal + external + arrayBuffers;
        let freeSize = totalSize - usedSize;
        let percentUsage = (usedSize / totalSize) * 100;

        return HttpUtils.sendJson(res, {
            memory: {
                free: freeSize,
                used: usedSize,
                total: totalSize,
                percent: percentUsage,
            },
        });
    }
}
