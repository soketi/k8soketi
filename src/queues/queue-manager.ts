import { Log } from '../log';
import { Options } from '../options';
import { Job } from './job';
import { QueueInterface } from './queue-interface';
import { SqsQueueManager } from './sqs-queue-manager';
import { SyncQueueManager } from './sync-queue-manager';

export class QueueManager {
    static driver: QueueInterface;
    static options: Options;

    static async initialize(options: Options) {
        switch (options.websockets.queueManagers.driver) {
            case 'sync':
                this.driver = new SyncQueueManager(options);
                break;
            case 'sqs':
                this.driver = new SqsQueueManager(options);
                break;
            default:
                Log.error('[Queue Manager] Queue driver was not initialized.');
                break;
        }
    }

    static async pushJob(job: Job): Promise<void> {
        return this.driver.pushJob(job);
    }

    static async processJobsFromQueue(queueName: string, callback: (job: Job) => Promise<void>): Promise<void> {
        return this.driver.processJobsFromQueue(queueName, callback);
    }

     static async disconnect(): Promise<void> {
        return this.driver.disconnect();
    }
}
