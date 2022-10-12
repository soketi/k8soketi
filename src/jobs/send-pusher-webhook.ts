import { AppManager } from '../app-managers/app-manager';
import axios from 'axios';
import { DefaultJobData, Job } from '../queues/job';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { Log } from '../log';

export interface PusherClientEventData {
    name: string;
    channel: string;
    event?: string,
    data?: {
        [key: string]: any;
    };
    socket_id?: string;
    user_id?: string;
    time_ms?: number;
}

export interface PusherWebhookJobData extends DefaultJobData {
    appKey: string;
    appId: string;
    payload: {
        time_ms: number;
        events: PusherClientEventData[];
    },
    originalPusherSignature: string;
}

export class SendPusherWebhook extends Job {
    async handle(): Promise<void> {
        let rawData = this.data as PusherWebhookJobData;

        const { appKey, payload, originalPusherSignature } = rawData;

        let app = await AppManager.findByKey(appKey);

        // Ensure the payload hasn't been tampered with between the job being dispatched
        // and here, as we may need to recalculate the signature post filtration.
        if (originalPusherSignature !== app.hmac(JSON.stringify(payload))) {
            return;
        }

        for await (let webhook of app.webhooks) {
            const originalEventsLength = payload.events.length;
            let filteredPayloadEvents = payload.events;

            // Filter payload events
            filteredPayloadEvents = filteredPayloadEvents.filter(event => {
                if (!webhook.event_types.includes(event.name)) {
                    return false;
                }

                if (webhook.filter) {
                    if (
                        webhook.filter.channel_name_starts_with
                        && !event.channel.startsWith(webhook.filter.channel_name_starts_with)
                    ) {
                        return false;
                    }

                    if (
                        webhook.filter.channel_name_ends_with
                        && !event.channel.endsWith(webhook.filter.channel_name_ends_with)
                    ) {
                        return false;
                    }
                }

                return true;
            });

            // If there's no webhooks to send after filtration, we should resolve early.
            if (filteredPayloadEvents.length === 0) {
                continue;
            }

            // If any events have been filtered out, regenerate the signature
            let pusherSignature = (originalEventsLength !== filteredPayloadEvents.length)
                ? app.hmac(JSON.stringify(payload))
                : originalPusherSignature;

            Log.info('[Queues][Webhooks][Pusher] Processing webhook from queue.');

            const headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'SoketiWebhooksAxiosClient/1.0',
                ...webhook.headers ?? {},
                'X-Pusher-Key': appKey,
                'X-Pusher-Signature': pusherSignature,
            };

            // Send HTTP POST to the target URL
            if (webhook.url) {
                try {
                    await axios.post(webhook.url, payload, { headers });
                    Log.info(`[Queues][Webhooks][Pusher] Webhook sent: ${webhook.url} with ${JSON.stringify(payload)}`);
                } catch (err) {
                    Log.warning(`[Queues][Webhooks][Pusher] Webhook could not be sent: ${err}`);
                }
            } else if (webhook.lambda_function) {
                // Invoke a Lambda function
                let lambda = new LambdaClient({
                    apiVersion: '2015-03-31',
                    region: webhook.lambda.region || 'us-east-1',
                    ...(webhook.lambda.client_options || {}),
                });

                try {
                    await lambda.send(new InvokeCommand({
                        FunctionName: webhook.lambda_function,
                        InvocationType: webhook.lambda.async ? 'Event' : 'RequestResponse',
                        Payload: Buffer.from(JSON.stringify({ payload, headers })),
                    }));

                    Log.info(`[Queues][Webhooks][Pusher] Lambda ${webhook.lambda_function} triggered.`);
                } catch (error) {
                    Log.warning(`[Queues][Webhooks][Pusher] Lambda ${webhook.lambda_function} trigger failed: ${error}`);
                }
            }
        }
    }
}
