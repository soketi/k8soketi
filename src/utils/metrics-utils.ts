export class MetricsUtils {
    static dataToBytes(...data: any): number {
        return data.reduce((totalBytes, element) => {
            element = typeof element === 'string' ? element : JSON.stringify(element);

            try {
                return totalBytes += Buffer.byteLength(element, 'utf8');
            } catch (e) {
                return totalBytes;
            }
        }, 0);
    }

    static dataToKilobytes(...data: any): number {
        return this.dataToBytes(...data) / 1024;
    }

    static dataToMegabytes(...data: any): number {
        return this.dataToKilobytes(...data) / 1024;
    }
}
