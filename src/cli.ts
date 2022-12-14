import Server from './server';
import { Option, program } from 'commander';

const registerStartCommand = async () => {
    let corsHeaders = [
        'Origin',
        'Content-Type',
        'X-Auth-Token',
        'X-Requested-With',
        'Accept',
        'Authorization',
        'X-CSRF-TOKEN',
        'XSRF-TOKEN',
        'X-Socket-Id',
    ];

    let corsMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];

    let cmdx = program.command('start');

    // Kubernetes
    cmdx.addOption(new Option('--kube-auth <kubeAuth>', 'The authentication method to the cluster.').env('KUBE_AUTH').default('in-cluster').choices(['in-cluster', 'kubeconfig']))
        .addOption(new Option('--kube-pod-name <kubePodName>', 'The name of the current pod.').default('k8soketi').env('KUBE_POD_NAME'))
        .addOption(new Option('--kube-pod-namespace <kubePodNamespace>', 'The namespace of the current pod.').default('default').env('KUBE_POD_NAMESPACE'))
        .addOption(new Option('--kube-pod-ip <kubePodIp>', 'The IP of the current pod.').default('10.32.0.1').env('KUBE_POD_IP'))
        .addOption(new Option('--kube-discovery-services <kubeDiscoveryServices>', 'The services, separated by commas, to discover other pods.').default('k8soketi.default.svc.cluster.local').env('KUBE_SERVICES'));

    // Connection
    cmdx.addOption(new Option('--host <host>', 'The host to run the WebSockets/HTTP server on.').env('HOST').default('0.0.0.0'))
        .addOption(new Option('--port <port>', 'The port to run the WebSockets/HTTP server on.').env('PORT').default(6001).argParser(v => parseInt(v)))
        // Peer Configuration
        .addOption(new Option('--peer-host <peerHost>', 'The host on which the peers will be exposed to TCP or WS. It has to be a private/public IP for distributed systems.').env('PEER_HOST').default('127.0.0.1'))
        .addOption(new Option('--peer-inactivity-timeout <peerInactivityTimeout>', 'The amount of time (in seconds) that should pass in order to disconnect a node from the P2P network.').env('PEER_INACTIVITY_TIMEOUT').default(10))
        .addOption(new Option('--peer-ws-port <peerWsPort>', 'The port on which the peer will be accessible via the WS protocol.').env('PEER_WS_PORT').default(11002).argParser(v => parseInt(v)))
        // WS Configuration
        .addOption(new Option('--ws-grace-period <wsGracePeriod>', 'The amount of time to wait (in seconds) for the connections to be evicted, before closing the WebSockets server.').env('WS_GRACE_PERIOD').default(1).argParser(v => parseInt(v)))
        .addOption(new Option('--ws-max-backpressure-in-mb <wsMaxBackpressureInMb>', 'The max. backpressure (in MB). Read more: https://github.com/uNetworking/uWebSockets.js/blob/master/examples/Backpressure.js').env('WS_MAX_BACKPRESSURE_IN_MB').default(1).argParser(v => parseInt(v)))
        .addOption(new Option('--ws-max-payload-in-mb <wsMaxPayloadInMb>', 'If a connection sends a payload greater than this amount (in MB), it will forcefully close the connection.').env('WS_MAX_PAYLOAD_IN_MB').default(100).argParser(v => parseInt(v)))
        .addOption(new Option('--mode <mode>', 'The mode to run as. Workers cannot serve HTTP/WS requests. Servers cannot process queued jobs.').env('WS_MAX_PAYLOAD_IN_MB').default('full').choices(['full', 'worker', 'server']));

    // Cache Managers
    cmdx.addOption(new Option('--cache-manager <cacheManager>', 'The cache driver to use.').default('memory').choices(['memory']));

    // App Managers
    cmdx.addOption(new Option('--app-manager <appManager>', 'The app manager driver to use.').default('array').choices(['array', 'dynamodb']))
        .addOption(new Option('--app-manager-cache', 'Allow app managers to cache app responses.').default(false))
        .addOption(new Option('--app-manager-cache-ttl <appManagerCacheTtl>', 'The TTL of cache for app responses.').default(-1).argParser(v => parseInt(v)))
        // DynamoDB
        .addOption(new Option('--app-manager-dynamodb-table <appManagerDynamodbTable>', 'The DynamoDB table name.').env('APP_MANAGER_DYNAMODB_TABLE').default('').implies({ appManager: 'dynamodb' }))
        .addOption(new Option('--app-manager-dynamodb-region <appManagerDynamodbRegion>', 'The DynamoDB table region name.').env('APP_MANAGER_DYNAMODB_REGION').default('us-east-1').implies({ appManager: 'dynamodb' }))
        .addOption(new Option('--app-manager-dynamodb-endpoint <appManagerDynamodbEndpoint>', 'The API URL of the DynamoDB service.').env('APP_MANAGER_DYNAMODB_ENDPOINT').default(null).implies({ appManager: 'dynamodb' }))

    // Queue Managers
    cmdx.addOption(new Option('--queue-manager <queueManager>', 'The queue manager driver to use.').default('sync').choices(['sync', 'sqs']))
        // SQS
        .addOption(new Option('--queue-sqs-region <queueSqsRegion>', 'The region of the SQS queue.').default('us-east-1').implies({ queueManager: 'sqs' }))
        .addOption(new Option('--queue-sqs-options <queueSqsOptions>', 'The JSON-formatted string with extra SQS options. Read more: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/configuring-the-jssdk.html').default('{}').argParser(v => JSON.parse(v)).implies({ queueManager: 'sqs' }))
        .addOption(new Option('--queue-sqs-consumer-options <queueSqsConsumerOptions>', 'The JSON-formatted string with extra SQS Consumer options. Read more: https://github.com/rxfork/sqs-consumer').default('{}').argParser(v => JSON.parse(v)).implies({ queueManager: 'sqs' }))
        .addOption(new Option('--queue-sqs-url <queueSqsUrl>', 'The SQS queue URL.').env('QUEUE_SQS_URL').default('').implies({ queueManager: 'sqs' }))
        .addOption(new Option('--queue-sqs-batching', 'Process the events in batch.').default(false).implies({ queueManager: 'sqs' }))
        .addOption(new Option('--queue-sqs-batch-size <queueSqsBatchSize>', 'The maximum amount of jobs to wait before polling once.').default(1).argParser(v => parseInt(v)).implies({ queueManager: 'sqs', queueSqsBatching: true }))
        .addOption(new Option('--queue-sqs-polling-wait-time-ms <queueSqsPollingWaitTimeMs>', 'The polling time (in ms) for the queue.').default(0).argParser(v => parseFloat(v)).implies({ queueManager: 'sqs' }))
        .addOption(new Option('--queue-sqs-endpoint <queueSqsEndpoint>', 'The API URL of the SQS service.').env('QUEUE_SQS_ENDPOINT').default('').implies({ queueManager: 'sqs' }));

    // Limits
    cmdx.addOption(new Option('--max-channel-name-length <maxChannelNameLength>', 'The default limit of max. characters for a  channel name.').default(200).argParser(v => parseFloat(v)))
        .addOption(new Option('--max-channels-on-broadcast <maxChannelsAtOnce>', 'The default limit of max. channels that can be passed in a single broadcast command.').default(100).argParser(v => parseFloat(v)))
        .addOption(new Option('--max-event-name-length <maxEventLengthName>', 'The default limit of max. characters for an event name.').default(200).argParser(v => parseFloat(v)))
        .addOption(new Option('--max-event-size-in-kb <maxEventPayloadInKb>', 'The default limit of max. size (in KB) for an event payload.').default(100).argParser(v => parseFloat(v)))
        .addOption(new Option('--max-event-batch-size <maxEventBatchSize>', 'The default limit of max. event objects that can be passed in a single batch broadcast command.').default(10).argParser(v => parseFloat(v)))
        .addOption(new Option('--max-presence-members <maxPresenceMembersPerChannel>', 'The default limit of max. members that can exist simultaneously in a presence channel.').default(100).argParser(v => parseFloat(v)))
        .addOption(new Option('--max-presence-member-size-in-kb <maxPresenceMemberSizeInKb>', 'The default limit of max. size (in KB) of a single presence member object.').default(2).argParser(v => parseFloat(v)))
        .addOption(new Option('--max-payload-size-in-mb <maxPayloadSizeInMb>', 'The limit of max. size (in MB) a HTTP payload can have before throwing 413 Payload To Large.').default(50).argParser(v => parseFloat(v)))
        .addOption(new Option('--accept-traffic-threshold <acceptTrafficThreshold>', 'The min. used memory percent after the pod will be marked as "not accepting new connections anymore".').default(80));

    // Metrics
    cmdx.addOption(new Option('--metrics', 'Enable the metrics endpoints.').default(false))
        .addOption(new Option('--metrics-server-host <metricsServerHost>', 'The host of the metrics server.').env('METRICS_SERVER_HOST').default('127.0.0.1').implies({ metrics: true }))
        .addOption(new Option('--metrics-server-port <metricsServerPort>', 'The port on the metrics server.').env('METRICS_SERVER_PORT').default(9601).argParser(v => parseInt(v)).implies({ metrics: true }))

    // CORS
    cmdx.addOption(new Option('--disable-cors-credentials', 'Disable credentials support for CORS').default(false))
        .addOption(new Option('--cors-origins <corsOrigins>', 'A comma-separated list of origins to allow through CORS.').default('*'))
        .addOption(new Option('--cors-methods <corsMethods>', 'A comma-separated list of HTTP methods to allow through CORS.').default(corsMethods.join(',')))
        .addOption(new Option('--cors-headers <corsHeaders>', 'A comma-separated list of headers to allow throuh CORS').default(corsHeaders.join(',')))

    // Logging
    cmdx.option('--verbose', 'Enable verbose messages.', false)
        .option('--show-warnings', 'Show warnings. Error are always shown.', false)
        .option('--timestamps', 'Enable logging timestamps.', false);

    cmdx.action(async (options, command) => {
        let server = new Server({
            // Kube
            'kube.authentication': options.kubeAuth,
            'kube.pod.name': options.kubePodName,
            'kube.pod.namespace': options.kubePodNamespace,
            'kube.pod.ip': options.kubePodIp,
            'kube.discovery.services': options.kubeDiscoveryServices.split(','),

            // Connection
            'websockets.server.host': options.host,
            'websockets.server.port': options.port,
            'websockets.server.gracePeriod': options.wsGracePeriod,
            'websockets.server.maxBackpressureInMb': options.wsMaxBackpressureInMb,
            'websockets.server.maxPayloadLengthInMb': options.wsMaxPayloadInMb,
            'websockets.mode': options.mode,
            // Peer
            'peer.ws.host': options.peerHost,
            'peer.ws.port': options.peerWsPort,
            'peer.inactivityTimeout': options.peerInactivityTimeout,

            // Cache Managers
            'websockets.cacheManagers.driver': options.cacheManager,

            // App Managers
            'websockets.appManagers.driver': options.appManager,
            'websockets.appManagers.cache.enabled': options.appManagerCache,
            'websockets.appManagers.cache.ttl': options.appManagerCacheTtl,
            // DynamoDB
            'websockets.appManagers.drivers.dynamodb.table': options.appManagerDynamodbTable,
            'websockets.appManagers.drivers.dynamodb.region': options.appManagerDynamodbRegion,
            'websockets.appManagers.drivers.dynamodb.endpoint': options.appManagerDynamodbEndpoint,

            // Queue Managers
            'websockets.queueManagers.driver': options.queueManager,
            // SQS
            'websockets.queueManagers.sqs.region': options.queueSqsRegion,
            'websockets.queueManagers.sqs.clientOptions': options.queueSqsOptions,
            'websockets.queueManagers.sqs.consumerOptions': options.queueSqsConsumerOptions,
            'websockets.queueManagers.sqs.url': options.queueSqsUrl,
            'websockets.queueManagers.sqs.processBatch': options.queueSqsBatching,
            'websockets.queueManagers.sqs.batchSize': options.queueSqsBatchSize,
            'websockets.queueManagers.sqs.pollingWaitTimeMs': options.queueSqsPollingWaitTimeMs,
            'websockets.queueManagers.sqs.endpoint': options.queueSqsEndpoint === '' ? null : options.queueSqsEndpoint,

            // Limits
            'websockets.limits.channels.maxNameLength': options.maxChannelNameLength,
            'websockets.limits.events.maxChannelsAtOnce': options.maxChannelsAtOnce,
            'websockets.limits.events.maxNameLength': options.maxEventLengthName,
            'websockets.limits.events.maxPayloadInKb': options.maxEventPayloadInKb,
            'websockets.limits.events.maxBatchSize': options.maxEventBatchSize,
            'websockets.limits.presence.maxMembersPerChannel': options.maxPresenceMembersPerChannel,
            'websockets.limits.presence.maxMemberSizeInKb': options.maxPresenceMemberSizeInKb,
            'websockets.http.maxPayloadSizeInMb': options.maxPayloadSizeInMb,
            'websockets.http.acceptTraffic.memoryThreshold': options.acceptTrafficThreshold,

            // Metrics
            'metrics.enabled': options.metrics,
            'metrics.server.host': options.metricsServerHost,
            'metrics.server.port': options.metricsServerPort,

            // CORS
            'cors.credentials': !options.disableCorsCredentials,
            'cors.origin': options.corsOrigins.split(','),
            'cors.methods': options.corsMethods.split(','),
            'cors.allowedHeaders': options.corsHeaders.split(','),

            // Logging
            'logs.verbose': options.verbose,
            'logs.timestamps': options.timestamps,
            'logs.showWarnings': options.showWarnings,
        }, true);

        await server.start();
    });
};

(async () => {
    await registerStartCommand();

    program.configureHelp({
        sortSubcommands: true,
        subcommandTerm: (cmd) => cmd.name(),
    });

    program.parse();
})();
