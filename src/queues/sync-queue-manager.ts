import { Job } from './job';
import { Log } from '../log';
import { Options } from '../options';
import { QueueInterface } from './queue-interface';

export class SyncQueueManager implements QueueInterface {
    constructor(protected options: Options) {
        //
    }

    async pushJob(job: Job): Promise<void> {
        Log.info(`[Queues][Sync] Job ${job.constructor.name} (ID: ${job.id}) on ${job.queue} received the payload: ${JSON.stringify(job.data)}`);
        await job.handle();
        Log.info(`[Queues][Sync] Job ${job.constructor.name} (ID: ${job.id}) on ${job.queue} was processed.`);
    }

    async processJobsFromQueue(queueName: string, callback: (job: Job) => Promise<void>): Promise<void> {
        //
    }

    async disconnect(): Promise<void> {
        //
    }
}
