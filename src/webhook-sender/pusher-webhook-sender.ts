import { App } from '../app-managers/app';
import { PusherClientEventData, SendPusherWebhook } from '../jobs/send-pusher-webhook';
import { Options } from '../options';
import { QueueManager } from '../queues/queue-manager';
import { WsUtils } from '../utils/ws-utils';

export class PusherWebhookSender {
    static batches: Map<string, Set<PusherClientEventData>>  = new Map();
    static batchHasLeader = false;
    static options: Options;

    static async initialize(options: Options) {
        this.options = options;

        let processJob = async (job: SendPusherWebhook) => await job.handle();

        if (this.canProcessQueues) {
            QueueManager.processJobsFromQueue('client_event_webhooks', processJob.bind(this));
            QueueManager.processJobsFromQueue('member_added_webhooks', processJob.bind(this));
            QueueManager.processJobsFromQueue('member_removed_webhooks', processJob.bind(this));
            QueueManager.processJobsFromQueue('channel_vacated_webhooks', processJob.bind(this));
            QueueManager.processJobsFromQueue('channel_occupied_webhooks', processJob.bind(this));
            QueueManager.processJobsFromQueue('cache_miss_webhooks', processJob.bind(this));
        }
    }

    static async sendClientEvent(app: App, channel: string, event: string, data: any, socketId?: string, userId?: string): Promise<void> {
        if (!app.hasClientEventWebhooks) {
            return;
        }

        let formattedData: PusherClientEventData = {
            name: App.CLIENT_EVENT_WEBHOOK,
            channel,
            event,
            data,
        };

        if (socketId) {
            formattedData.socket_id = socketId;
        }

        if (userId && WsUtils.isPresenceChannel(channel)) {
            formattedData.user_id = userId;
        }

        await this.send(app, formattedData, 'client_event_webhooks');
    }

    static async sendMemberAdded(app: App, channel: string, userId: string): Promise<void> {
        if (!app.hasMemberAddedWebhooks) {
            return;
        }

        await this.send(app, {
            name: App.MEMBER_ADDED_WEBHOOK,
            channel,
            user_id: userId,
        }, 'member_added_webhooks');
    }

    static async sendMemberRemoved(app: App, channel: string, userId: string): Promise<void> {
        if (!app.hasMemberRemovedWebhooks) {
            return;
        }

        await this.send(app, {
            name: App.MEMBER_REMOVED_WEBHOOK,
            channel,
            user_id: userId,
        }, 'member_removed_webhooks');
    }

    static async sendChannelVacated(app: App, channel: string): Promise<void> {
        if (!app.hasChannelVacatedWebhooks) {
            return;
        }

        await this.send(app, {
            name: App.CHANNEL_VACATED_WEBHOOK,
            channel,
        }, 'channel_vacated_webhooks');
    }

    static async sendChannelOccupied(app: App, channel: string): Promise<void> {
        if (!app.hasChannelOccupiedWebhooks) {
            return;
        }

        await this.send(app, {
            name: App.CHANNEL_OCCUPIED_WEBHOOK,
            channel,
        }, 'channel_occupied_webhooks');
    }

    static async sendCacheMissed(app: App, channel: string): Promise<void> {
        if (!app.hasCacheMissedWebhooks) {
            return;
        }

        await this.send(app, {
            name: App.CACHE_MISSED_WEBHOOK,
            channel,
        }, 'cache_miss_webhooks');
    }

    protected static async send(app: App, data: PusherClientEventData, queueName: string): Promise<void> {
        if (this.options.websockets.webhooks.batching.enabled) {
            return this.sendWebhookByBatching(app, data, queueName);
        }

        return this.sendWebhook(app, data, queueName);
    }

    protected static async sendWebhook(app: App, data: PusherClientEventData|PusherClientEventData[], queueName: string): Promise<void> {
        let events = data instanceof Array ? data : [data];

        if (events.length === 0) {
            return;
        }

        // According to the Pusher docs: The time_ms key provides the unix timestamp in milliseconds when the webhook was created.
        // So we set the time here instead of creating a new one in the queue handler so you can detect delayed webhooks when the queue is busy.
        let time = (new Date).getTime();

        let payload = {
            time_ms: time,
            events,
        };

        let originalPusherSignature = app.hmac(JSON.stringify(payload));

        await QueueManager.pushJob(
            new SendPusherWebhook({
                appKey: app.key,
                appId: app.id,
                payload,
                originalPusherSignature,
            }, queueName)
        );
    }

    protected static async sendWebhookByBatching(app: App, data: PusherClientEventData, queueName: string): Promise<void> {
        if (!this.batches.has(app.id)) {
            this.batches.set(app.id, new Set);
        }

        this.batches.get(app.id).add(data);

        // If there's no batch leader, elect itself as the batch leader, then wait an arbitrary time using
        // setTimeout to build up a batch, before firing off the full batch of events in one webhook.
        if (!this.batchHasLeader) {
            this.batchHasLeader = true;

            setTimeout(() => {
                if (this.batches.get(app.id).size > 0) {
                    let events = this.batches.get(app.id);
                    this.batches.delete(app.id);
                    this.sendWebhook(app, [...events], queueName);
                }

                this.batchHasLeader = false;
            }, this.options.websockets.webhooks.batching.duration);
        }
    }

    static get canProcessQueues(): boolean {
        return ['worker', 'full'].includes(this.options.websockets.mode);
    }
}
