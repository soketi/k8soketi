import { Consumer, ConsumerOptions } from '@rxfork/sqs-consumer';
import { createHash } from 'crypto';
import { DefaultJobData, Job } from './job';
import { Log } from '../log';
import { Message, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { SyncQueueManager } from './sync-queue-manager';
import { SendPusherWebhook } from '../jobs/send-pusher-webhook';

export interface UnserializedMessage {
    data: DefaultJobData;
    id: string;
    queue: string;
    class: string;
}

export class SqsQueueManager extends SyncQueueManager {
    protected queueWithConsumer: Map<string, Consumer> = new Map();

    async pushJob(job: Job): Promise<void> {
        let payload: UnserializedMessage = {
            data: job.data,
            id: job.id,
            queue: job.queue,
            class: job.constructor.name,
        };

        let message = JSON.stringify(payload);

        try {
            await this.sqsClient().send(new SendMessageCommand({
                MessageBody: message,
                MessageDeduplicationId: createHash('sha256').update(message).digest('hex'),
                MessageGroupId: `${job.data.appId}_${job.queue}`,
                QueueUrl: this.options.websockets.queueManagers.sqs.url,
            }));
        } catch (error) {
            Log.warning(`[Queues][SQS] The job cannot be pushed to the ${job.queue} queue: ${error} (SQS message: ${message})`);
        };
    }

    async processJobsFromQueue(queueName: string, callback: (job: Job) => Promise<void>): Promise<void> {
        let handleMessage = async ({ Body }: Message) => {
            let unserializedMessage: UnserializedMessage = JSON.parse(Body);
            let job = this.extractJobFromUnserializedMessage(unserializedMessage);

            Log.info(`[Queues][SQS] Job ${job.constructor.name} (ID: ${job.id}) on ${job.queue} received the payload: ${Body}`);
            await callback(job);
            Log.info(`[Queues][SQS] Job ${job.constructor.name} (ID: ${job.id}) on ${job.queue} was processed.`);
        };

        let consumerOptions: ConsumerOptions = {
            queueUrl: this.options.websockets.queueManagers.sqs.url,
            sqs: this.sqsClient(),
            batchSize: this.options.websockets.queueManagers.sqs.batchSize,
            pollingWaitTimeMs: this.options.websockets.queueManagers.sqs.pollingWaitTimeMs,
            ...this.options.websockets.queueManagers.sqs.consumerOptions,
        };

        if (this.options.websockets.queueManagers.sqs.processBatch) {
            consumerOptions.handleMessageBatch = (messages) => {
                return Promise.all(
                    messages.map(({ Body }) => handleMessage({ Body }))
                ).then(() => {
                    //
                });
            };
        } else {
            consumerOptions.handleMessage = handleMessage;
        }

        let consumer = Consumer.create(consumerOptions);

        consumer.start();

        this.queueWithConsumer.set(queueName, consumer);
    }

    async disconnect(): Promise<void> {
        for await (let [queue, consumer] of [...this.queueWithConsumer]) {
            if (consumer.isRunning) {
                consumer.stop();
            }
        }
    }

    protected sqsClient(): SQSClient {
        let sqsOptions = this.options.websockets.queueManagers.sqs;

        return new SQSClient({
            apiVersion: '2012-11-05',
            region: sqsOptions.region || 'us-east-1',
            endpoint: sqsOptions.endpoint,
            ...sqsOptions.clientOptions,
        });
    }

    protected extractJobFromUnserializedMessage(m: UnserializedMessage): Job {
        switch (m.class) {
            case 'SendPusherWebhook':
                return new SendPusherWebhook(m.data, m.queue, m.id);
                break;
            default:
                return new Job();
        }
    }
}
