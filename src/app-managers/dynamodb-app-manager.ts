import { App } from './app';
import { AttributeValue, DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { BaseAppManager } from './base-app-manager';
import { Log } from '../log';
import { Options } from '../options';
import { toString } from 'uint8arrays/to-string';
import { unmarshall } from '@aws-sdk/util-dynamodb';

export class DynamoDbAppManager extends BaseAppManager {
    protected dynamodb: DynamoDBClient;

    constructor(protected options: Options) {
        super();

        this.dynamodb = new DynamoDBClient({
            apiVersion: '2012-08-10',
            region: options.websockets.appManagers.drivers.dynamodb.region,
            endpoint: options.websockets.appManagers.drivers.dynamodb.endpoint,
        });
    }

    async findById(id: string): Promise<App|null> {
        try {
            let { Item } = await this.dynamodb.send(new GetItemCommand({
                TableName: this.options.websockets.appManagers.drivers.dynamodb.table,
                Key: { AppId: { S: id } },
            }));

            if (!Item) {
                return null;
            }

            return new App(await this.unmarshallItem(Item), this.options);
        } catch (error) {
            Log.info(`[App Manager][DynamoDB] App with ID ${id} was not found: ${error}`);
            return null;
        }
    }

    async findByKey(key: string): Promise<App|null> {
        try {
            let { Items } = await this.dynamodb.send(new QueryCommand({
                TableName: this.options.websockets.appManagers.drivers.dynamodb.table,
                IndexName: 'AppKeyIndex',
                ScanIndexForward: false,
                Limit: 1,
                KeyConditionExpression: 'AppKey = :app_key',
                ExpressionAttributeValues: { ':app_key': { S: key } },
            }));

            if (!Items[0]) {
                return null;
            }

            return new App(await this.unmarshallItem(Items[0]), this.options);
        } catch (error) {
            Log.info(`[App Manager][DynamoDB] App with key ${key} was not found: ${error}`);
            return null;
        }
    }

    protected async unmarshallItem(item: Record<string, AttributeValue>): Promise<{ [key: string]: any; }> {
        let appObject = unmarshall(item);

        for await (let key of Object.keys(appObject)) {
            if (appObject[key] instanceof Buffer) {
                appObject[key] = Boolean(appObject[key].toString());
            }

            if (appObject[key] instanceof Uint8Array) {
                appObject[key] = toString(appObject[key]);

                if (appObject[key] === 'true') {
                    appObject[key] = true;
                } else if (appObject[key] === 'false') {
                    appObject[key] = false;
                }
            }

            if (
                typeof appObject[key] === 'string'
                && (
                    appObject[key].startsWith('{')
                    || appObject[key].startsWith('[')
                )
            ) {
                try {
                    appObject[key] = JSON.parse(appObject[key]);
                } catch (e) {
                    Log.warning(`[App Manager][DynamoDB] Cannot parse the app object's ${key} value that looks like a JSON: ${appObject[key]} - ${e}`);

                    if (appObject[key].startsWith('{')) {
                        appObject[key] = {};
                    } else if (appObject[key].startsWith('[')) {
                        appObject[key] = [];
                    }
                }
            }
        }

        return appObject;
    }
}
