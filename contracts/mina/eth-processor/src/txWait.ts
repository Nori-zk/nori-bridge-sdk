import { Logger } from '@nori-zk/proof-conversion';
import { fetchTransactionStatus } from 'o1js';

const logger = new Logger('EthProcessorTxWait');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function wait(
    txId: string,
    minaRPCNetworkUrl: string,
    maxAttempts = 50,
    intervalMs = 20000
): Promise<boolean> {
    logger.verbose(`Waiting for tx with id:\n${txId}`);
    let attempt = 0;
    do {
        try {
            logger.verbose(
                `Fetching transaction status attempt '${attempt + 1}'.`
            );
            const status = await fetchTransactionStatus(
                txId,
                minaRPCNetworkUrl
            );
            logger.verbose(
                `Received transaction status '${status}' for attempt '${
                    attempt + 1
                }'.`
            );
            if (status === 'INCLUDED') {
                return true;
            }
        } catch (err) {
            logger.warn(
                // prettier-ignore
                `Error during fetchTransactionStatus (attempt '${attempt + 1}'):\n${String(err)}`
            );
        }
        attempt++;
        if (attempt < maxAttempts) await sleep(intervalMs);
    } while (attempt < maxAttempts);

    logger.warn(`Max attempts exceeded while waiting for a tx. Aborting.`);

    throw new Error(
        `Max attempts exceeded while waiting for tx with id:\n${txId}`
    );
}
