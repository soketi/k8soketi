import { CoreV1Api, DiscoveryV1Api, KubeConfig, V1Pod } from '@kubernetes/client-node';
import { CustomEvent, EventEmitter } from '@libp2p/interfaces/events';
import { IncomingMessage } from 'http';
import { Log } from '../log';
import { multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
import { symbol } from '@libp2p/interface-peer-discovery';

import type { PeerDiscovery, PeerDiscoveryEvents } from '@libp2p/interface-peer-discovery';
import type { PeerInfo } from '@libp2p/interface-peer-info';
import type { PeerStore } from '@libp2p/interface-peer-store';
import type { Startable } from '@libp2p/interfaces/dist/src/startable';

export interface K8sServiceDiscoveryInit {
    services: string[];
    kc: KubeConfig;
    namespace: string;
    peerPort: number|string;
    currentPod: string;
}

export interface K8sServiceDiscoveryComponents {
    peerStore: PeerStore;
}

class K8sServiceDiscovery extends EventEmitter<PeerDiscoveryEvents> implements PeerDiscovery, Startable {
    protected timeout?: ReturnType<typeof setTimeout>;
    protected readonly services: PeerInfo[];
    protected readonly interval: number = 5e3;

    constructor (
        protected components: K8sServiceDiscoveryComponents,
        protected options: K8sServiceDiscoveryInit = {
            services: [],
            kc: new KubeConfig,
            currentPod: 'k8soketi',
            namespace: 'default',
            peerPort: 6002,
        },
    ) {
        if (options.services == null || options.services.length === 0) {
            throw new Error('Service discovery requires a services of Kubernetes service hostnames.');
        }

        super();
    }

    isStarted() {
        return Boolean(this.timeout);
    }

    start() {
        if (this.isStarted()) {
            return;
        }

        let discoverPeers = () => {
            void this.discoverPeers().catch(err => {
                Log.error(`[Discover] ${err}`);
                throw err;
            });
        };

        this.timeout = setTimeout(() => {
            void discoverPeers();
        }, this.interval);

        discoverPeers();
    }

    async discoverPeers(): Promise<void> {
        if (this.timeout == null) {
            return;
        }

        for await (let hostname of this.options.services) {
            if (this.timeout == null) {
                return;
            }

            // try {
                let {
                    body: { items: endpointSlices },
                } = await this.options.kc.makeApiClient(DiscoveryV1Api).listNamespacedEndpointSlice(
                    this.options.namespace,
                    'true',
                    false,
                    null,
                    null,
                    `kubernetes.io/service-name=${hostname}`,
                );

                for await (let slice of endpointSlices) {
                    let promises: Promise<{
                        response: IncomingMessage;
                        body: V1Pod;
                        addresses: string[];
                    }>[] = [];

                    promises = slice.endpoints.reduce((promises, { addresses, conditions, targetRef }) => {
                        // Exclude ourselves.
                        if (targetRef.name === this.options.currentPod && targetRef.namespace === this.options.namespace) {
                            return promises;
                        }

                        if (!conditions.ready) {
                            return promises;
                        }

                        let promise = this.options.kc.makeApiClient(CoreV1Api).readNamespacedPod(
                            targetRef.name, this.options.namespace,
                        );

                        promises.push(promise.then(response => ({ ...response, addresses })));
                        return promises;
                    }, promises);

                    Promise.allSettled(promises).then(async (results) => {
                        for await (let result of results) {
                            if (result.status === 'rejected') {
                                continue;
                            }

                            let { addresses, body: { metadata } } = result.value;
                            let peerId = metadata?.annotations['k8s.soketi.app/peer-id'] || null;

                            if (!peerId) {
                                continue;
                            }

                            addresses.forEach(address => {
                                this.dispatchEvent(new CustomEvent<PeerInfo>('peer', {
                                    detail: {
                                        id: peerIdFromString(peerId),
                                        multiaddrs: [
                                            multiaddr(`/ip4/${address}/tcp/${this.options.peerPort}/ws`),
                                        ],
                                        protocols: [],
                                    },
                                }));
                            });
                        }
                    });
                }

                // Log.info(`🤖 Marked the current pod with the peer id: ${this.peerId.toString()}`);
                // Log.info(`🤖 Current pod IP: ${this.options.kube.pod.ip}`);
                // Log.info('🤖 Add the following annotation to your services selectors: k8s.soketi.app/ready=yes');
            // } catch (e) {
            //     Log.error(`The service discovery had an issue: ${e}`);
            //     throw new Error('Stopping the server.');
            // }
        }
    }

    stop() {
        if (this.timeout != null) {
            clearTimeout(this.timeout);
        }

        this.timeout = undefined;
    }

    get [symbol](): true {
        return true;
    }

    get [Symbol.toStringTag]() {
        return 'k8soketi/k8s-service-discovery';
    }
}

export function bootstrap(init: K8sServiceDiscoveryInit): (components: K8sServiceDiscoveryComponents) => PeerDiscovery {
    return (components: K8sServiceDiscoveryComponents) => new K8sServiceDiscovery(components, init);
}
