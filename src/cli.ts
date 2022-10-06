import Server from './server';
import { program } from 'commander';

(async () => {
    program.command('start')
        .option('--host <host>', 'The host to run on.', '0.0.0.0')
        .option('--port <port>', 'The port to run on.', '6001')
        .option('-v --verbose', 'Enable verbose messages.', false)
        .option('-t --timestamps', 'Enable logging timestamps.', false)
        .action(async (options, command) => {
            let server = new Server({
                'logs.verbose': options.verbose,
                'logs.timestamps': options.timestamps,
                'websockets.server.host': options.host,
                'websockets.server.port': options.port,
            }, true);

            await server.start();
        });

    program.parse();
})();
