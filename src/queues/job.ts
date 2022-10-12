import { v4 as uuidv4 } from 'uuid';

export interface DefaultJobData {
    [key: string]: any;
}

export interface JobInterface {
    handle(): Promise<void>;
}

export interface SerializedJob {
    id: string;
    queue: string;
    data: DefaultJobData;
}

export class Job implements JobInterface {
    constructor(
        public data: DefaultJobData = {},
        public queue: string = 'default',
        public id: string = uuidv4(),
    ) {
        //
    }

    async handle(): Promise<void> {
        //
    }
}
