import { bootstrap } from './discovery/k8s-service-discovery';
import { Connection } from '@libp2p/interface-connection';
import { CoreV1Api, KubeConfig, KubernetesObjectApi } from '@kubernetes/client-node';
import { createLibp2p, Libp2p } from 'libp2p';
import { fromString } from 'uint8arrays/from-string';
import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { Log } from './log';
import { mplex } from '@libp2p/mplex';
import { noise } from '@chainsafe/libp2p-noise';
import { Options } from './options';
import { PeerId } from '@libp2p/interface-peer-id';
import { PeerInfo } from '@libp2p/interface-peer-info';
import { pipe } from 'it-pipe';
import { Prometheus } from './prometheus';
import { PubsubMessage } from './message';
import { toString } from 'uint8arrays/to-string';
import v8 from 'v8';
import { webSockets } from '@libp2p/websockets';

export interface RequestData {
    peerId: PeerId;
    action: string;
    version?: string;
    data: { [key: string]: any; };
}

export interface PeerRequestData {
    action: string;
    version?: string;
    data: { [key: string]: any; };
}

export interface RequestHandlerData {
    action: string;
    version?: string;
    onRequest?: (
        data: { [key: string]: any; },
        peerId: PeerId,
        streamId: string,
    ) => Promise<string>;
}

export class PeerNode {
    protected libp2p: Libp2p;
    protected ensurePeerIsRunningHandlers: Set<CallableFunction> = new Set();
    protected listenersByTopic: Map<string, Set<(message: { [key: string]: any; }) => void>> = new Map();
    protected kc: KubeConfig;
    closing = false;
    memoryLocked = false;

    constructor(public options: Options) {
        //
    }

    async initialize(): Promise<void> {
        await this.connectToCluster();

        this.libp2p = await createLibp2p({
            addresses: {
                listen: [
                    `/ip4/${this.options.peer.ws.host}/tcp/${this.options.peer.ws.port}/ws`,
                ],
            },
            relay: {
                enabled: true,
                autoRelay: {
                    enabled: true,
                    maxListeners: 10,
                },
                hop: {
                    enabled: true,
                },
                advertise: {
                    enabled: true,
                },
            },
            transports: [
                webSockets(),
            ],
            streamMuxers: [
                mplex({
                    maxMsgSize: 1 * 1024 * 1024, // TODO: Configurable
                    maxStreamBufferSize: 4 * 1024 * 1024, // TODO: Configurable
                }),
            ],
            connectionEncryption: [
                noise(),
            ],
            pubsub: (components) => new GossipSub(components, {
                allowPublishToZeroPeers: true,
                emitSelf: false,
                heartbeatInterval: 5e3,
            }),
            peerDiscovery: [
                bootstrap({
                    kc: this.kc,
                    services: this.options.kube.discovery.services,
                    currentPod: this.options.kube.pod.name,
                    namespace: this.options.kube.pod.namespace,
                    peerPort: this.options.peer.ws.port,
                }),
            ],
            metrics: {
                enabled: this.options.metrics.enabled,
            },
        });

        await this.updatePodMetadata();
        await this.registerMemoryThresholdLockers();
        await this.registerPings();
        await this.registerPeerDiscovery();
        await this.registerPubSubMessageHandler();
    }

    protected async registerPings(): Promise<void> {
        setInterval(() => {
            Promise.all(this.peers.map(peer => this.libp2p.ping(peer)));
        }, (this.options.peer.inactivityTimeout/3) * 1000);
    }

    protected async registerPeerDiscovery(): Promise<void> {
        this.onNewPeerConnection(async event => {
            Log.info(`[Network][Connection] Connected to ${event.detail.remoteAddr}/p2p/${event.detail.remotePeer.toString()}`);
            Prometheus.peers(this.peers.length);
        });

        this.onPeerDisconnection(async event => {
            Log.info(`[Network][Connection] Disconnected from ${event.detail.remoteAddr}/p2p/${event.detail.remotePeer.toString()}`);
            Prometheus.peers(this.peers.length);
        });

        this.onPeerDiscovery(async event => {
            // TODO: Fix too many logs
            // Log.info(`[Network][Discovery] Discovered ${event.detail.id.toString()} through ${event.detail.multiaddrs}`);
            await this.addressBook.set(event.detail.id, event.detail.multiaddrs);
            await this.libp2p.dial(event.detail.id);
        });
    }

    protected async registerPubSubMessageHandler(): Promise<void> {
        this.ensurePeerIsRunning(async () => {
            this.libp2p.pubsub.addEventListener('message', async (message) => {
                let topic = message.detail.topic;

                if (!this.listenersByTopic.has(topic)) {
                    return;
                }

                let stringData = toString(message.detail.data);
                Log.info(`[Pubsub][Topic: ${topic}] Received message: ${stringData}`);

                for await (let handler of this.listenersByTopic.get(topic)) {
                    await handler(JSON.parse(stringData));
                }
            });
        });
    }

    async onNewPeerConnection(callback: (event: CustomEvent<Connection>) => void): Promise<void> {
        this.libp2p.connectionManager.addEventListener('peer:connect', callback);
    }

    async onPeerDiscovery(callback: (event: CustomEvent<PeerInfo>) => void): Promise<void> {
        this.libp2p.addEventListener('peer:discovery', callback);
    }

    async onPeerDisconnection(callback: (event: CustomEvent<Connection>) => void): Promise<void> {
        this.libp2p.connectionManager.addEventListener('peer:disconnect', callback);
    }

    async publishMessage(topic: string, message: { [key: string]: any; }) {
        this.libp2p.pubsub.publish(topic, fromString(JSON.stringify(message)));
    }

    async subscribeToTopic(topic: string, callback: (message: PubsubMessage) => void): Promise<void> {
        this.ensurePeerIsRunning(async () => {
            this.libp2p.pubsub.subscribe(topic);

            if (!this.listenersByTopic.has(topic)) {
                this.listenersByTopic.set(topic, new Set);
            }

            this.listenersByTopic.get(topic).add(callback);

            Log.info(`[Pubsub][Topic: ${topic}] Subscribed`);
        });
    }

    async unsubscribeFromTopic(topic: string): Promise<void> {
        try {
            this.libp2p.pubsub.unsubscribe(topic);
            this.listenersByTopic.delete(topic);
        } catch (e) {
            Log.info(`[Pubsub][Topic: ${topic}] Unsubscribe failed: ${e}`);
        }
    }

    async handleRequest({ onRequest, action, version = '1' }: RequestHandlerData): Promise<void> {
        await this.libp2p.handle(`/v${version}/${action}`, async ({ connection, stream }) => {
            this.watchStreamForMetrics(connection.remotePeer, stream, `/v${version}/${action}`);

            await pipe(stream, async (source) => {
                for await (let data of source) {
                    let stringData = toString(data.subarray());
                        Log.info(`[Request][/v${version}/${action}][Stream: ${stream.id}] Received request: ${stringData}`);

                        let responseData = await onRequest(
                            JSON.parse(stringData),
                            connection.remotePeer,
                            stream.id,
                        );

                        stream.sink([fromString(responseData + '')]);
                        Log.info(`[Request][/v${version}/${action}][Stream: ${stream.id}] Replied with: ${responseData}`);
                    }
                }
            );
        });
    }

    async makeRequest({ peerId, action, version = '1', data }: RequestData): Promise<string> {
        return new Promise(async resolve => {
            try {
                let stream = await this.libp2p.dialProtocol(peerId, `/v${version}/${action}`);
                let requestData = fromString(JSON.stringify(data));

                Log.info(`[Request][/v${version}/${action}][Stream: ${stream.id}] Making request: ${JSON.stringify(data)}`);

                this.watchStreamForMetrics(peerId, stream, `/v${version}/${action}`);

                pipe([requestData], stream, async (source) => {
                    for await (let data of source) {
                        let response = toString(data.subarray());
                        Log.info(`[Request][/v${version}/${action}][Stream: ${stream.id}] Received: ${response}`);
                        resolve(response);
                    }
                });
            } catch (e) {
                Log.warning(`[Request][/v${version}/${action}] ${e}`);
            }
        });
    }

    async makeRequestToAllPeers({ version = '1', action, data }: PeerRequestData): Promise<string[]> {
        if (this.peers.length === 0) {
            return [];
        }

        let promises = [];

        for await (let peerId of this.peers) {
            promises.push(
                this.makeRequest({
                    peerId,
                    action,
                    data,
                    version,
                })
            );
        }

        Log.info(`[Request][/v${version}/${action}] Making request to ${this.peers.length} peers.`);

        return Promise.all(promises);
    }

    async ensurePeerIsRunning(callback: CallableFunction): Promise<void> {
        try {
            await callback();
        } catch (e) {
            this.ensurePeerIsRunningHandlers.add(callback);
            Log.warning(`[Peer] Tried to run a function, but received ${e}, so we added it to the handler stack.`);
        }
    }

    async peersWatchingApp(appId: string): Promise<PeerId[]> {
        let peers = this.libp2p.getPeers();
        let watchingPeers = [];

        for await (let peer of peers) {
            let tags = await this.libp2p.peerStore.getTags(peer);

            if (tags.find(t => t.name === appId)) {
                watchingPeers.push(peer);
            }
        }

        Prometheus.peersWatchingApp(watchingPeers.length, appId);

        return watchingPeers;
    }

    watchStreamForMetrics(remotePeer: PeerId, stream: any, protocol: string): void {
        if (!this.libp2p.metrics) {
            return;
        }

        this.libp2p.metrics.trackStream({
            remotePeer,
            stream,
            protocol,
        });
    }

    protected async connectToCluster(): Promise<void> {
        this.kc = new KubeConfig();

        switch (this.options.kube.authentication) {
            case 'in-cluster':
                this.kc.loadFromCluster();
            case 'kubeconfig':
                this.kc.loadFromDefault();
                break;
            default:
                Log.error(`The Kubernetes authentication method cannot be handled. Got: ${this.options.kube.authentication}`);
                throw new Error('Could not start server.');
        }
    }

    protected async updatePodMetadata(): Promise<void> {
        try {
            await this.kc.makeApiClient(CoreV1Api).patchNamespacedPod(
                this.options.kube.pod.name,
                this.options.kube.pod.namespace,
                {
                    metadata: {
                        annotations: {
                            'k8s.soketi.app/peer-id': this.peerId.toString(),
                            'k8s.soketi.app/ready': 'yes',
                        },
                        labels: {
                            'k8s.soketi.app/low-memory': 'no',
                        },
                    },
                },
                undefined, undefined, undefined, undefined, undefined, { headers: { 'Content-Type': 'application/merge-patch+json' } },
            );

            Log.info(`🤖 Marked the current pod with the peer id: ${this.peerId.toString()}`);
            Log.info(`🤖 Current pod IP: ${this.options.kube.pod.ip}`);
            Log.info('🤖 Add the following annotation to your services selectors: k8s.soketi.app/ready=yes');
        } catch (e) {
            Log.error(`Updating the pod metadata did not work: ${e}`);
            throw new Error('Could not start server.');
        }
    }

    protected async registerMemoryThresholdLockers(): Promise<void> {
        setInterval(() => {
            let threshold = this.options.websockets.http.acceptTraffic.memoryThreshold;

            let {
                rss,
                heapTotal,
                external,
                arrayBuffers,
            } = process.memoryUsage();

            let totalSize = v8.getHeapStatistics().total_available_size;
            let usedSize = rss + heapTotal + external + arrayBuffers;
            let percentUsage = (usedSize / totalSize) * 100;
            let lowMemory = threshold < percentUsage;

            let shouldUpdatePod = lowMemory !== this.memoryLocked;
            this.memoryLocked = lowMemory;

            if (shouldUpdatePod) {
                this.kc.makeApiClient(CoreV1Api).patchNamespacedPod(
                    this.options.kube.pod.name,
                    this.options.kube.pod.namespace,
                    {
                        metadata: {
                            labels: {
                                'k8s.soketi.app/low-memory': lowMemory ? 'yes': 'no',
                            },
                        },
                    },
                    undefined, undefined, undefined, undefined, undefined, { headers: { 'Content-Type': 'application/merge-patch+json' } },
                );
            }
        }, 1e3);
    }

    get peers() {
        return this.libp2p.getPeers();
    }

    get peerStore() {
        return this.libp2p.peerStore;
    }

    get addressBook() {
        return this.peerStore.addressBook;
    }

    get metadataBook() {
        return this.peerStore.metadataBook;
    }

    get metrics() {
        return this.libp2p.metrics;
    }

    get peerId() {
        return this.libp2p.peerId;
    }

    async start(): Promise<void> {
        this.libp2p.start();

        for await (let handler of this.ensurePeerIsRunningHandlers) {
            handler();
        }
    }

    async stop(): Promise<void> {
        this.closing = true;
        await this.libp2p.stop();
    }
}
