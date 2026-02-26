import { createTimer, EthVerifier } from "@nori-zk/o1js-zk-utils";
import { LogPrinter, Logger } from "esm-iso-logger";
import { NoriTokenBridge } from "../NoriTokenBridge.js";
import { NoriStorageInterface } from "src/NoriStorageInterface.js";

new LogPrinter('CompileWorker');
const logger = new Logger('CompileWorker');

export class CompileWorker {
    async compile() {
        logger.log('Compiling contracts');
        const timeStorage = createTimer();
        const { verificationKey: storageVK } = await NoriStorageInterface.compile();
        logger.debug(`Compiled NoriStorageInterface in ${timeStorage()}`);
        logger.info(`NoriStorageInterface verification key: ${storageVK.hash.toString()}`);
        const timeEthVerifier = createTimer();
        const { verificationKey: ethVerifierVK } = await EthVerifier.compile();
        logger.debug(`Compiled EthVerifier in ${timeEthVerifier()}`);
        logger.info(`EthVerifier verification key: ${ethVerifierVK.hash.toString()}`);
        const timeNewBridge = createTimer();
        const { verificationKey: noriTokenBridgeVK } = await NoriTokenBridge.compile();
        logger.debug(`Compiled noriTokenBridgeVK in ${timeNewBridge()}`);
        logger.info(`noriTokenBridgeVK verification key: ${noriTokenBridgeVK.hash.toString()}`);
    }
    constructor() {

    }
}