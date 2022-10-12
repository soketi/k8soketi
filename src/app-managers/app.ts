import { createHmac } from 'crypto';
import { HttpResponse } from 'uWebSockets.js';
import { LambdaClientConfig } from '@aws-sdk/client-lambda';
import { Options } from '../options';
import Pusher from 'pusher';
import pusherUtil from 'pusher/lib/util';

export interface AppInterface {
    id: string;
    key: string;
    secret: string;
    maxConnections: string|number;
    enableClientMessages: boolean;
    enabled: boolean;
    maxBackendEventsPerSecond?: string|number;
    maxClientEventsPerSecond: string|number;
    maxReadRequestsPerSecond?: string|number;
    webhooks?: WebhookInterface[];
    maxPresenceMembersPerChannel?: string|number;
    maxPresenceMemberSizeInKb?: string|number;
    maxChannelNameLength?: number;
    maxEventChannelsAtOnce?: string|number;
    maxEventNameLength?: string|number;
    maxEventPayloadInKb?: string|number;
    maxEventBatchSize?: string|number;
    enableUserAuthentication?: boolean;
    hasClientEventWebhooks?: boolean;
    hasChannelOccupiedWebhooks?: boolean;
    hasChannelVacatedWebhooks?: boolean;
    hasMemberAddedWebhooks?: boolean;
    hasMemberRemovedWebhooks?: boolean;
}

export interface WebhookInterface {
    url?: string;
    headers?: {
        [key: string]: string;
    };
    lambda_function?: string;
    event_types: string[];
    filter?: {
        channel_name_starts_with?: string;
        channel_name_ends_with?: string;
    };
    lambda: {
        async?: boolean;
        region?: string;
        client_options?: LambdaClientConfig,
    };
}

export class App implements AppInterface {
    id: string;
    key: string;
    secret: string;
    enableClientMessages: boolean;
    enableUserAuthentication = false;
    enabled: boolean;
    webhooks: WebhookInterface[];

    maxConnections: string|number;
    maxBackendEventsPerSecond: string|number;
    maxClientEventsPerSecond: string|number;
    maxReadRequestsPerSecond: string|number;

    maxPresenceMembersPerChannel: string|number;
    maxPresenceMemberSizeInKb: string|number;
    maxChannelNameLength: number;

    maxEventChannelsAtOnce: string|number;
    maxEventNameLength: string|number;
    maxEventPayloadInKb: string|number;
    maxEventBatchSize: string|number;

    hasClientEventWebhooks = false;
    hasChannelOccupiedWebhooks = false;
    hasChannelVacatedWebhooks = false;
    hasMemberAddedWebhooks = false;
    hasMemberRemovedWebhooks = false;
    hasCacheMissedWebhooks = false;

    static readonly CLIENT_EVENT_WEBHOOK = 'client_event';
    static readonly CHANNEL_OCCUPIED_WEBHOOK = 'channel_occupied';
    static readonly CHANNEL_VACATED_WEBHOOK = 'channel_vacated';
    static readonly MEMBER_ADDED_WEBHOOK = 'member_added';
    static readonly MEMBER_REMOVED_WEBHOOK = 'member_removed';
    static readonly CACHE_MISSED_WEBHOOK = 'cache_miss';

    constructor(public initialApp: { [key: string]: any; }, protected options: Options) {
        this.id = this.extractFromPassedKeys(initialApp, ['id', 'AppId'], 'app-id');
        this.key = this.extractFromPassedKeys(initialApp, ['key', 'AppKey'], 'app-key');
        this.secret = this.extractFromPassedKeys(initialApp, ['secret', 'AppSecret'], 'app-secret');
        this.enableClientMessages = this.extractFromPassedKeys(initialApp, ['enableClientMessages', 'EnableClientMessages', 'enable_client_messages'], false);
        this.enableUserAuthentication = this.extractFromPassedKeys(initialApp, ['enableUserAuthentication', 'EnableUserAuthentication', 'enable_user_authentication'], false);
        this.enabled = this.extractFromPassedKeys(initialApp, ['enabled', 'Enabled'], true);
        this.webhooks = this.transformPotentialJsonToArray(this.extractFromPassedKeys(initialApp, ['webhooks', 'Webhooks'], '[]'));

        this.maxConnections = this.extractFromPassedKeys(initialApp, ['maxConnections', 'MaxConnections', 'max_connections'], -1);
        this.maxBackendEventsPerSecond = parseInt(this.extractFromPassedKeys(initialApp, ['maxBackendEventsPerSecond', 'MaxBackendEventsPerSecond', 'max_backend_events_per_sec'], -1));
        this.maxClientEventsPerSecond = parseInt(this.extractFromPassedKeys(initialApp, ['maxClientEventsPerSecond', 'MaxClientEventsPerSecond', 'max_client_events_per_sec'], -1));
        this.maxReadRequestsPerSecond = parseInt(this.extractFromPassedKeys(initialApp, ['maxReadRequestsPerSecond', 'MaxReadRequestsPerSecond', 'max_read_req_per_sec'], -1));

        this.maxPresenceMembersPerChannel = parseInt(this.extractFromPassedKeys(initialApp, ['maxPresenceMembersPerChannel', 'MaxPresenceMembersPerChannel', 'max_presence_members_per_channel'], options.websockets.limits.presence.maxMembersPerChannel));
        this.maxPresenceMemberSizeInKb = parseFloat(this.extractFromPassedKeys(initialApp, ['maxPresenceMemberSizeInKb', 'MaxPresenceMemberSizeInKb', 'max_presence_member_size_in_kb'], options.websockets.limits.presence.maxMemberSizeInKb));
        this.maxChannelNameLength = parseInt(this.extractFromPassedKeys(initialApp, ['maxChannelNameLength', 'MaxChannelNameLength', 'max_channel_name_length'], options.websockets.limits.channels.maxNameLength));

        this.maxEventChannelsAtOnce = parseInt(this.extractFromPassedKeys(initialApp, ['maxEventChannelsAtOnce', 'MaxEventChannelsAtOnce', 'max_event_channels_at_once'], options.websockets.limits.events.maxChannelsAtOnce));
        this.maxEventNameLength = parseInt(this.extractFromPassedKeys(initialApp, ['maxEventNameLength', 'MaxEventNameLength', 'max_event_name_length'], options.websockets.limits.events.maxNameLength));
        this.maxEventPayloadInKb = parseFloat(this.extractFromPassedKeys(initialApp, ['maxEventPayloadInKb', 'MaxEventPayloadInKb', 'max_event_payload_in_kb'], options.websockets.limits.events.maxPayloadInKb));
        this.maxEventBatchSize = parseInt(this.extractFromPassedKeys(initialApp, ['maxEventBatchSize', 'MaxEventBatchSize', 'max_event_batch_size'], options.websockets.limits.events.maxBatchSize));

        this.hasClientEventWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.CLIENT_EVENT_WEBHOOK)).length > 0;
        this.hasChannelOccupiedWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.CHANNEL_OCCUPIED_WEBHOOK)).length > 0;
        this.hasChannelVacatedWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.CHANNEL_VACATED_WEBHOOK)).length > 0;
        this.hasMemberAddedWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.MEMBER_ADDED_WEBHOOK)).length > 0;
        this.hasMemberRemovedWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.MEMBER_REMOVED_WEBHOOK)).length > 0;
        this.hasCacheMissedWebhooks = this.webhooks.filter(webhook => webhook.event_types.includes(App.CACHE_MISSED_WEBHOOK)).length > 0;
    }

    toObject(): AppInterface {
        return {
            id: this.id,
            key: this.key,
            secret: this.secret,
            enableClientMessages: this.enableClientMessages,
            enableUserAuthentication: this.enableUserAuthentication,
            enabled: this.enabled,
            webhooks: this.webhooks,
            maxConnections: this.maxConnections,
            maxBackendEventsPerSecond: this.maxBackendEventsPerSecond,
            maxClientEventsPerSecond: this.maxClientEventsPerSecond,
            maxReadRequestsPerSecond: this.maxReadRequestsPerSecond,
            maxPresenceMembersPerChannel: this.maxPresenceMembersPerChannel,
            maxPresenceMemberSizeInKb: this.maxPresenceMemberSizeInKb,
            maxChannelNameLength: this.maxChannelNameLength,
            maxEventChannelsAtOnce: this.maxEventChannelsAtOnce,
            maxEventNameLength: this.maxEventNameLength,
            maxEventPayloadInKb: this.maxEventPayloadInKb,
            maxEventBatchSize: this.maxEventBatchSize,
        }
    }

    toJson(): string {
        return JSON.stringify(this.toObject());
    }

    forWebSocket(): App {
        let app = new App(this.initialApp, this.options);

        // delete app.secret;
        delete app.maxBackendEventsPerSecond;
        delete app.maxReadRequestsPerSecond;
        delete app.webhooks;

        return app;
    }

    signingTokenFromRequest(res: HttpResponse): string {
        const params = {
            auth_key: this.key,
            auth_timestamp: res.query.auth_timestamp,
            auth_version: res.query.auth_version,
            ...res.query,
        };

        delete params['auth_signature'];
        delete params['body_md5']
        delete params['appId'];
        delete params['appKey'];
        delete params['channelName'];

        if (res.rawBody) {
            params['body_md5'] = pusherUtil.getMD5(res.rawBody);
        }

        return this.signString([
            res.method,
            res.url,
            pusherUtil.toOrderedArray(params).join('&'),
        ].join("\n"));
    }

    signString(str: string): string {
        let token = new (Pusher as any).Token(this.key, this.secret);
        return token.sign(str);
    }

    hmac(str: string): string {
        return createHmac('sha256', this.secret)
            .update(str)
            .digest('hex');
    }

    protected extractFromPassedKeys(app: { [key: string]: any; }, parameters: string[], defaultValue: any): any {
        let extractedValue = defaultValue;

        parameters.forEach(param => {
            if (typeof app[param] !== 'undefined' && !['', null].includes(app[param])) {
                extractedValue = app[param];
            }
        });

        return extractedValue;
    }

    protected transformPotentialJsonToArray(potentialJson: any): any {
        if (potentialJson instanceof Array) {
            return potentialJson;
        }

        try {
            let potentialArray = JSON.parse(potentialJson);

            if (potentialArray instanceof Array) {
                return potentialArray;
            }
        } catch (e) {
            //
        }

        return [];
    }
}
