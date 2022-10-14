import { Log } from './log';
import { MetricsHttpApiHandler } from './handlers/metrics-http-api-handler';
import { Options } from './options';
import { PeerNode } from './peerNode';
import { Prometheus } from './prometheus';
import { TemplatedApp } from 'uWebSockets.js';
import uWS from 'uWebSockets.js';
import { WebsocketsNode } from './websocketsNode';

export class MetricsNode {
    protected app: TemplatedApp;
    protected process: uWS.us_listen_socket;
    peerNode: PeerNode;
    wsNode: WebsocketsNode;

    constructor(protected options: Options) {
        //
    }

    async initialize(peerNode: PeerNode, wsNode: WebsocketsNode): Promise<void> {
        this.peerNode = peerNode;
        this.wsNode = wsNode;
        this.app = uWS.App();

        Prometheus.initialize(peerNode, wsNode);
        MetricsHttpApiHandler.wsNode = wsNode;

        await this.registerRoutes();

        setInterval(async () => {
            for await (let protocol of this.peerNode.metrics.getProtocols()) {
                let { dataReceived, dataSent } = this.peerNode.metrics
                    .forProtocol(protocol)
                    .getSnapshot();

                Prometheus.peerNetwork(dataReceived, dataSent, protocol);
            }
        }, 1e3);
    }

    async start(): Promise<void> {
        this.app.listen(this.options.metrics.server.host, this.options.metrics.server.port, process => {
            this.process = process;
            Log.info(`📈 The metrics server is available at http://127.0.0.1:${this.options.metrics.server.port}`, true);
        });
    }

    async stop(): Promise<void> {
        uWS.us_listen_socket_close(this.process);
    }

    protected async registerRoutes(): Promise<void> {
        this.app.get('/', async (res, req) => {
            return await MetricsHttpApiHandler.serve('healthCheck', res, req);
        });

        this.app.get('/metrics', async (res, req) => {
            return await MetricsHttpApiHandler.serve('prometheusMetrics', res, req);
        });

        this.app.get('/memory', async (res, req) => {
            return await MetricsHttpApiHandler.serve('memoryMetrics', res, req);
        });

        this.app.any('/*', async (res, req) => {
            return await MetricsHttpApiHandler.serve('notFound', res, req);
        });
    }
}
