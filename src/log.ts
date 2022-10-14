import colors from 'colors';

export class Log {
    static verbose = false;
    static timestamps = false;
    static showWarnings = false;

    static colorsList = {
        '[Pubsub]': 'magenta',
        '[App Manager]': 'cyan',
        '[Request]': 'gray',
        '[WebSockets]': 'blue',
        '[Discovery]': 'green',
        '[Queues]': 'green',
        '[Cache]': 'magenta',
        '[Rate Limiter]': 'gray',
    };

    static enableVerbosity() {
        this.verbose = true;
    }

    static enableTimestamps() {
        this.timestamps = true;
    }

    static info(message: string, forceVerbose = false): void {
        let color = 'cyan';

        for (let tag of Object.keys(this.colorsList)) {
            if (message.includes(tag)) {
                color = this.colorsList[tag];
                break;
            }
        }

        this.log(message, forceVerbose, color, 'mx-2');
    }

    static success(message: string, forceVerbose = false): void {
        this.log(message, forceVerbose, 'green', 'mx-2');
    }

    static error(message: any): void {
        this.log(message, true, 'red', 'mx-2');
    }

    static warning(message: any): void {
        if (!this.showWarnings) {
            return;
        }

        this.log(message, true, 'yellow', 'mx-2');
    }

    static br(): void {
        console.log('');
    }

    protected static prefixWithTime(message: any): any {
        if (typeof message === 'string') {
            return '[' + (new Date).toString() + '] ' + message;
        }

        return message;
    }

    protected static log(message: string, forceVerbose = false, ...styles: string[]): void {
        let withColor: any = colors;

        if (!this.verbose && !forceVerbose) {
            return;
        }

        if (this.timestamps) {
            message = this.prefixWithTime(message);
        }

        if (typeof message !== 'string') {
            return console.log(message);
        }

        styles
            .filter(style => ! /^[m|p]x-/.test(style))
            .forEach((style) => withColor = withColor[style]);

        const applyMargins = (message: string): string => {
            const spaces = styles
                .filter(style => /^mx-/.test(style))
                .map(style => ' '.repeat(parseInt(style.substr(3))))
                .join('');

            return spaces + message + spaces;
        }

        const applyPadding = (message: string): string => {
            const spaces = styles
                .filter(style => /^px-/.test(style))
                .map(style => ' '.repeat(parseInt(style.substr(3))))
                .join('');

            return spaces + message + spaces;
        }

        console.log(applyMargins(withColor(applyPadding(message))));
    }
}
