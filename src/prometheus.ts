import * as prom from 'prom-client';
import { MetricsUtils } from './utils/metrics-utils';
import { Options } from './options';
import { PeerNode } from './peerNode';
import { WebSocket } from './websocket';
import { WebsocketsNode } from './websocketsNode';

interface WsNamespaceTags {
    app_id: string;
    [key: string]: any;
}

interface PeerNamespaceTags {
    protocol: string;
    [key: string]: any;
}

export class Prometheus {
    static registry: prom.Registry = new prom.Registry();
    static peerNode: PeerNode;
    static wsNode: WebsocketsNode;
    static enabled = false;
    static options: Options;

    static metrics = {
        connectedSockets: new prom.Gauge({
            name: 'connected',
            help: 'The number of currently connected sockets.',
            labelNames: ['app_id'],
            registers: [this.registry],
        }),
        newConnectionsTotal: new prom.Counter({
            name: 'new_connections_total',
            help: 'Total amount of soketi connection requests.',
            labelNames: ['app_id'],
            registers: [this.registry],
        }),
        newDisconnectionsTotal: new prom.Counter({
            name: 'new_disconnections_total',
            help: 'Total amount of soketi disconnections.',
            labelNames: ['app_id'],
            registers: [this.registry],
        }),
        socketBytesReceived: new prom.Counter({
            name: 'socket_received_bytes',
            help: 'Total amount of bytes that soketi received.',
            labelNames: ['app_id'],
            registers: [this.registry],
        }),
        socketBytesTransmitted: new prom.Counter({
            name: 'socket_transmitted_bytes',
            help: 'Total amount of bytes that soketi transmitted.',
            labelNames: ['app_id'],
            registers: [this.registry],
        }),
        wsMessagesReceived: new prom.Counter({
            name: 'ws_messages_received_total',
            help: 'The total amount of WS messages received from connections by the server.',
            labelNames: ['app_id'],
            registers: [this.registry],
        }),
        wsMessagesSent: new prom.Counter({
            name: 'ws_messages_sent_total',
            help: 'The total amount of WS messages sent to the connections from the server.',
            labelNames: ['app_id'],
            registers: [this.registry],
        }),
        httpBytesReceived: new prom.Counter({
            name: 'http_received_bytes',
            help: 'Total amount of bytes that soketi\'s REST API received.',
            labelNames: ['app_id'],
            registers: [this.registry],
        }),
        httpBytesTransmitted: new prom.Counter({
            name: 'http_transmitted_bytes',
            help: 'Total amount of bytes that soketi\'s REST API sent back.',
            labelNames: ['app_id'],
            registers: [this.registry],
        }),
        httpCallsReceived: new prom.Counter({
            name: 'http_calls_received_total',
            help: 'Total amount of received REST API calls.',
            labelNames: ['app_id'],
            registers: [this.registry],
        }),
        peerDataReceived: new prom.Gauge({
            name: 'peer_received_bytes',
            help: 'Total amount of bytes that the node received from other peers.',
            labelNames: ['protocol'],
            registers: [this.registry],
        }),
        peerDataSent: new prom.Gauge({
            name: 'peer_transmitted_bytes',
            help: 'Total amount of bytes that the node sent to other peers.',
            labelNames: ['protocol'],
            registers: [this.registry],
        }),
    };

    static initialize(peerNode: PeerNode, wsNode: WebsocketsNode) {
        this.peerNode = peerNode;
        this.wsNode = wsNode;

        prom.collectDefaultMetrics({
            register: this.registry,
        });
    }

    static newConnection(ws: WebSocket): void {
        this.metrics.connectedSockets.inc(this.getWsTags(ws.app ? ws.app.id : null));
        this.metrics.newConnectionsTotal.inc(this.getWsTags(ws.app ? ws.app.id : null));
    }

    static newDisconnection(ws: WebSocket): void {
        this.metrics.connectedSockets.dec(this.getWsTags(ws.app ? ws.app.id : null));
        this.metrics.newDisconnectionsTotal.inc(this.getWsTags(ws.app ? ws.app.id : null));
    }

    static apiMessage(appId: string, incomingMessage: any, sentMessage: any): void {
        this.metrics.httpBytesReceived.inc(this.getWsTags(appId), MetricsUtils.dataToBytes(incomingMessage));
        this.metrics.httpBytesTransmitted.inc(this.getWsTags(appId), MetricsUtils.dataToBytes(sentMessage));
        this.metrics.httpCallsReceived.inc(this.getWsTags(appId));
    }

    static sentWsMessage(sentMessage: any, ws: WebSocket): void {
        this.metrics.socketBytesTransmitted.inc(this.getWsTags(ws.app ? ws.app.id : null), MetricsUtils.dataToBytes(sentMessage));
        this.metrics.wsMessagesSent.inc(this.getWsTags(ws.app ? ws.app.id : null), 1);
    }

    static receivedWsMessage(appId: string, message: any): void {
        this.metrics.socketBytesReceived.inc(this.getWsTags(appId), MetricsUtils.dataToBytes(message));
        this.metrics.wsMessagesReceived.inc(this.getWsTags(appId), 1);
    }

    static peerNetwork(dataReceived: bigint, dataSent: bigint, protocol: string): void {
        this.metrics.peerDataReceived.set(this.getPeerTags(protocol), Number(dataReceived));
        this.metrics.peerDataSent.set(this.getPeerTags(protocol), Number(dataSent));
    }

    protected static getWsTags(appId: string): WsNamespaceTags {
        return { app_id: appId };
    }

    protected static getPeerTags(protocol: string): PeerNamespaceTags {
        return { protocol };
    }
}
