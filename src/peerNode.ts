import { Connection } from '@libp2p/interface-connection';
import { createLibp2p, Libp2p } from 'libp2p';
import { fromString } from 'uint8arrays/from-string';
import { GossipSub } from '@chainsafe/libp2p-gossipsub';
import { Log } from './log';
import { Mplex } from '@libp2p/mplex';
import { MulticastDNS } from '@libp2p/mdns';
import { Noise } from '@chainsafe/libp2p-noise';
import { Options } from './options';
import { PeerId } from '@libp2p/interface-peer-id';
import { PeerInfo } from '@libp2p/interface-peer-info';
import { pipe } from 'it-pipe';
import { PubsubMessage } from './message';
import { TCP } from '@libp2p/tcp';
import { toString } from 'uint8arrays/to-string';

export interface RequestData {
    peerId: PeerId;
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
    closing = false;

    constructor(protected options: Options) {
        //
    }

    async initialize(): Promise<void> {
        let { host: discoveryHost, port: discoveryPort } = this.options.websockets.dns.discovery;
        let { host: dnsHost, port: dnsPort } = this.options.websockets.dns.server;

        this.libp2p = await createLibp2p({
            addresses: {
                listen: [`/ip4/${discoveryHost}/tcp/${discoveryPort}`],
            },
            transports: [
                new TCP(), // TODO: Timeout settings
            ],
            streamMuxers: [
                new Mplex(), // TODO: Mplex settings
            ],
            connectionEncryption: [
                new Noise(), // TODO: Use SSL keys
            ],
            pubsub: new GossipSub({
                allowPublishToZeroPeers: true, // TODO: Pubsub settings
            }),
            peerDiscovery: [
                new MulticastDNS({
                    interval: 5e3,
                    // TODO: DNS IP
                    port: dnsPort,
                    broadcast: true,
                }),
            ],
        });

        await this.registerPeerDiscovery();
        await this.registerPubSubMessageHandler();
    }

    protected async registerPeerDiscovery(): Promise<void> {
        this.onNewPeerConnection(async event => {
            Log.info(`[Network][Connection] Connected to ${event.detail.remoteAddr}/p2p/${event.detail.remotePeer.toString()}`);
        });

        this.onPeerDiscovery(async event => {
            Log.info(`[Network][Discovery] Discovered ${event.detail.id.toString()} through ${event.detail.multiaddrs}`);
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
            await pipe(stream, async (source) => {
                for await (let data of source) {
                    let stringData = toString(data.subarray());
                        Log.info(`[Request][Stream: ${stream.id}][/v${version}/${action}] Received request: ${stringData}`);

                        let responseData = await onRequest(
                            JSON.parse(stringData),
                            connection.remotePeer,
                            stream.id,
                        );

                        stream.sink([fromString(responseData)]);
                        Log.info(`[Request][Stream: ${stream.id}][/v${version}/${action}] Replied with: ${responseData}`);
                    }
                }
            );
        });
    }

    async makeRequest({ peerId, action, version = '1', data }: RequestData): Promise<{ [key: string]: any; }> {
        return new Promise(async resolve => {
            try {
                let stream = await this.libp2p.dialProtocol(peerId, `/v${version}/${action}`);

                let requestData = fromString(JSON.stringify(data));

                Log.info(`[Request][/v${version}/${action}] Making request: ${requestData}`);

                pipe([requestData], stream, async (source) => {
                    for await (let data of source) {
                        resolve(JSON.parse(toString(data.subarray())));
                    }
                });
            } catch (e) {
                Log.warning(`[Request][/v${version}/${action}] ${e}`);
            }
        });
    }

    async ensurePeerIsRunning(callback: CallableFunction): Promise<void> {
        try {
            await callback();
        } catch (e) {
            this.ensurePeerIsRunningHandlers.add(callback);
            Log.warning(`[Peer] Tried to run a function, but received ${e}, so we added it to the handler stack.`);
        }
    }

    subscribedPeers(topic: string) {
        return this.libp2p.pubsub.getSubscribers(topic);
    }

    get addressBook() {
        return this.libp2p.peerStore.addressBook;
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
