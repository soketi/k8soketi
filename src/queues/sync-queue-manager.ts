import { Job } from './job';
import { Options } from '../options';
import { QueueInterface } from './queue-interface';

export class SyncQueueManager implements QueueInterface {
    constructor(protected options: Options) {
        //
    }

    async pushJob(job: Job): Promise<void> {
        await job.handle();
    }

    async processJobsFromQueue(queueName: string, callback: (job: Job) => Promise<void>): Promise<void> {
        //
    }

    async disconnect(): Promise<void> {
        //
    }
}
