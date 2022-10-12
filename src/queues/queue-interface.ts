import { Job } from './job';

export interface QueueInterface {
    driver?: QueueInterface;

    pushJob(job: Job): Promise<void>;
    processJobsFromQueue(queueName: string, callback: (job: Job) => Promise<void>): Promise<void>;
    disconnect(): Promise<void>;
}
