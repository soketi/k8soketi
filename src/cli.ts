import Server from './server';
import { program } from 'commander';

(async () => {
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

    program.command('start')
        .option('--host <host>', 'The host to run on.', '0.0.0.0')
        .option('--port <port>', 'The port to run on.', '6001')
        .option('--dns-discovery-host <dnsDiscoveryHost>', 'The host on which the peers will discovery through.', '127.0.0.1')
        .option('--dns-discovery-port <dnsDiscoveryPort>', 'The port on which the peers will discover through.', '16001')
        .option('--dns-server-host <dnsServerHost>', 'The host of the DNS server to query to get the other peers.', '127.0.0.1')
        .option('--dns-server-port <dnsServerPort>', 'The port on the DNS server to query to get the other peers.', '53')
        .option('--verbose', 'Enable verbose messages.', false)
        .option('--timestamps', 'Enable logging timestamps.', false)
        .option('--cache <cache>', 'The cache driver to use. (available: "memory")', 'memory')
        .option('--app-manager <appManager>', 'The app manager driver to use. (available: "array")', 'array')
        .option('--app-manager-cache', 'Allow app managers to cache app responses.', false)
        .option('--app-manager-cache-ttl <appManagerCacheTtl>', 'The TTL of cache for app responses.', '-1')
        .option('--max-channel-name-length <maxChannelNameLength>', 'The default limit of max. characters for a  channel name.', '200')
        .option('--max-channels-on-broadcast <maxChannelsAtOnce>', 'The default limit of max. channels that can be passed in a single broadcast command.', '100')
        .option('--max-event-name-length <maxEventLengthName>', 'The default limit of max. characters for an event name.', '200')
        .option('--max-event-size-in-kb <maxEventPayloadInKb>', 'The default limit of max. size (in KB) for an event payload.', '100')
        .option('--max-event-batch-size <maxEventBatchSize>', 'The default limit of max. event objects that can be passed in a single batch broadcast command.', '10')
        .option('--max-presence-members <maxPresenceMembersPerChannel>', 'The default limit of max. members that can exist simultaneously in a presence channel.', '100')
        .option('--max-presence-member-size-in-kb <maxPresenceMemberSizeInKb>', 'The default limit of max. size (in KB) of a single presence member object.', '2')
        .option('--metrics', 'Enable the metrics endpoints.', false)
        .option('--metrics-server-host <metricsServerHost>', 'The host of the metrics server.', '127.0.0.1')
        .option('--metrics-server-port <metricsServerPort>', 'The port on the metrics server.', '9601')
        .option('--disable-cors-credentials', 'Disable credentials support for CORS', false)
        .option('--cors-origins <corsOrigins>', 'A comma-separated list of origins to allow through CORS.', '*')
        .option('--cors-methods <corsMethods>', 'A comma-separated list of HTTP methods to allow through CORS.', ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].join(','))
        .option('--cors-headers <corsHeaders>', 'A comma-separated list of headers to allow throuh CORS', corsHeaders.join(','))
        .option('--max-payload-size-in-mb <maxPayloadSizeInMb>', 'The limit of max. size (in MB) a HTTP payload can have before throwing 413 Payload To Large.', '50')
        .option('--accept-traffic-threshold <acceptTrafficThreshold>', 'The min. used memory percent after the /accept-traffic endpoint will return 500 errors (used to probe traffic redirection).')
        .action(async (options, command) => {
            let server = new Server({
                'logs.verbose': options.verbose,
                'logs.timestamps': options.timestamps,
                'websockets.appManagers.cache.enabled': options.appManagerCache,
                'websockets.appManagers.cache.ttl': parseInt(options.appManagerCacheTtl),
                'websockets.appManagers.driver': options.appManager,
                'websockets.cache.driver': options.cache,
                'websockets.dns.discovery.host': options.dnsDiscoveryHost,
                'websockets.dns.discovery.port': options.dnsDiscoveryPort,
                'websockets.dns.server.host': options.dnsServerHost,
                'websockets.dns.server.port': options.dnsServerPort,
                'websockets.limits.channels.maxNameLength': parseInt(options.maxChannelNameLength),
                'websockets.limits.events.maxChannelsAtOnce': parseInt(options.maxChannelsAtOnce),
                'websockets.limits.events.maxNameLength': parseInt(options.maxEventLengthName),
                'websockets.limits.events.maxPayloadInKb': parseInt(options.maxEventPayloadInKb),
                'websockets.limits.events.maxBatchSize': parseInt(options.maxEventBatchSize),
                'websockets.limits.presence.maxMembersPerChannel': parseInt(options.maxPresenceMembersPerChannel),
                'websockets.limits.presence.maxMemberSizeInKb': parseInt(options.maxPresenceMemberSizeInKb),
                'websockets.server.host': options.host,
                'websockets.server.port': parseInt(options.port),
                'metrics.enabled': options.metrics,
                'metrics.server.host': options.metricsServerHost,
                'metrics.server.port': parseInt(options.metricsServerPort),
                'cors.credentials': !options.disableCorsCredentials,
                'cors.origin': options.corsOrigins.split(','),
                'cors.methods': options.corsMethods.split(','),
                'cors.allowedHeaders': options.corsHeaders.split(','),
                'websockets.http.maxPayloadSizeInMb': parseInt(options.maxPayloadSizeInMb),
                'websockets.http.acceptTraffic.memoryThreshold': parseFloat(options.acceptTrafficThreshold),
            }, true);

            await server.start();
        });

    program.parse();
})();
