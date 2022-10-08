export class WsUtils {
    protected static _clientEventPatterns: string[] = [
        'client-*',
    ];

    protected static _privateChannelPatterns: string[] = [
        'private-*',
        'private-encrypted-*',
        'presence-*',
    ];

    protected static _cachingChannelPatterns: string[] = [
        'cache-*',
        'private-cache-*',
        'private-encrypted-cache-*',
        'presence-cache-*',
    ];

    static isPrivateChannel(channel: string): boolean {
        let isPrivate = false;

        this._privateChannelPatterns.forEach(pattern => {
            let regex = new RegExp(pattern.replace('*', '.*'));

            if (regex.test(channel)) {
                isPrivate = true;
            }
        });

        return isPrivate;
    }

    static isPresenceChannel(channel: string): boolean {
        return channel.lastIndexOf('presence-', 0) === 0;
    }

    static isEncryptedPrivateChannel(channel: string): boolean {
        return channel.lastIndexOf('private-encrypted-', 0) === 0;
    }

    static isCachingChannel(channel: string): boolean {
        let isCachingChannel = false;

        this._cachingChannelPatterns.forEach(pattern => {
            let regex = new RegExp(pattern.replace('*', '.*'));

            if (regex.test(channel)) {
                isCachingChannel = true;
            }
        });

        return isCachingChannel;
    }

    static isClientEvent(event: string): boolean {
        let isClientEvent = false;

        this._clientEventPatterns.forEach(pattern => {
            let regex = new RegExp(pattern.replace('*', '.*'));

            if (regex.test(event)) {
                isClientEvent = true;
            }
        });

        return isClientEvent;
    }

    static restrictedChannelName(name: string) {
        return /^#?[-a-zA-Z0-9_=@,.;]+$/.test(name) === false;
    }
}
