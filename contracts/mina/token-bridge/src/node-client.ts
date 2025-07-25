import { ContractDepositAttestor } from '@nori-zk/o1js-zk-utils/build/contractDepositAttestor.js';
import { getBridgeSocket$ } from './rx/bridge/socket.js';
import { getBridgeStateWithTimings$ } from './rx/bridge/state.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
} from './rx/bridge/topics.js';
import { getEthStateTopic$ } from './rx/eth/topic.js';
import { EthVerifier } from '@nori-zk/o1js-zk-utils/build/ethVerifier.js';
import { E2EPrerequisitesProgram } from './e2ePrerequisites.js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
} from './attestation.js';
import {
    BehaviorSubject,
    combineLatest,
    finalize,
    firstValueFrom,
    map,
    Subject,
    switchMap,
    take,
    tap,
} from 'rxjs';
import { NodeJsClientState } from './rx/node-client/state.js';

class NodeClient {
    bridgeSocket$ = getBridgeSocket$();

    ethStateTopic$ = getEthStateTopic$(this.bridgeSocket$);
    bridgeStateTopic$ = getBridgeStateTopic$(this.bridgeSocket$);
    bridgeTimingsTopic$ = getBridgeTimingsTopic$(this.bridgeSocket$);

    bridgeState$ = getBridgeStateWithTimings$(
        this.bridgeStateTopic$,
        this.bridgeTimingsTopic$
    );

    bridgeComsReady$ = combineLatest([
        this.ethStateTopic$,
        this.bridgeStateTopic$,
        this.bridgeTimingsTopic$,
    ]).pipe(
        take(1),
        map(() => true)
    ); // Completes as soon as all fire.

    subject = new BehaviorSubject<NodeJsClientState>(
        NodeJsClientState.Initialising
    );
    $ = this.subject.asObservable();

    depositBlockNumberSubject = new BehaviorSubject<number | undefined>(
        undefined
    );
    depositBlockNumber$ = this.depositBlockNumberSubject.asObservable();

    /*depositPastFinality = this.depositBlockNumber$.pipe(
        switchMap((depositNumber) => {
            console.log('Deposit detected', depositNumber);
            this.subject.next(NodeJsClientState.WaitingForEthFinality);
            return waitForDepositFinalization$(
                depositNumber,
                this.ethStateTopic$
            ).pipe(
                tap((waitTime) => console.log('Waiting for finality', waitTime))
            );
        }),
        //finalize(() => this.subject.next(NodeJsClientState.))
    )*/



    

    async compilePreRequisites() {
        // TODO optimise not all of these need to be compiled immediately

        console.time('ContractDepositAttestor compile');
        const { verificationKey: contractDepositAttestorVerificationKey } =
            await ContractDepositAttestor.compile({ forceRecompile: true });
        console.timeEnd('ContractDepositAttestor compile');
        console.log(
            `ContractDepositAttestor contract compiled vk: '${contractDepositAttestorVerificationKey.hash}'.`
        );

        console.time('EthVerifier compile');
        const { verificationKey: ethVerifierVerificationKey } =
            await EthVerifier.compile({ forceRecompile: true });
        console.timeEnd('EthVerifier compile');
        console.log(
            `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
        );

        console.time('E2EPrerequisitesProgram compile');
        const { verificationKey: e2ePrerequisitesVerificationKey } =
            await E2EPrerequisitesProgram.compile({ forceRecompile: true });
        console.timeEnd('E2EPrerequisitesProgram compile');
        console.log(
            `E2EPrerequisitesProgram contract compiled vk: '${e2ePrerequisitesVerificationKey.hash}'.`
        );

        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compilePresentationVerifier'); // 11.507s
    }

    async ready() {
        // What about a timeout for failure too.
        try {
            await this.compilePreRequisites();
            await firstValueFrom(this.bridgeComsReady$);
            this.subject.next(NodeJsClientState.Initialised);
        } catch (e) {
            const error = e as unknown as Error;
            console.error(error.stack);
            this.subject.next(NodeJsClientState.InitialisationFailed);
            throw error;
        }
    }

    async attemptedDeposit(depositBlockNumber: number) {
        const existingDeposit = this.depositBlockNumberSubject.getValue();
        if (existingDeposit)
            throw new Error(
                'A deposit has already been made. Currently you are not allowed to make multiple deposits.'
            );
        // For now we do this externally and we assume it has been done correctly.
        const state = this.subject.value;
        if (this.subject.value !== NodeJsClientState.Initialised)
            throw new Error(
                `Should not have deposited unless NodeJsClientState.Initialised client was in state '${state}' instead`
            );
        this.depositBlockNumberSubject.next(depositBlockNumber);
        this.depositBlockNumberSubject.complete();
        this.subject.next(NodeJsClientState.LockedTokens);
    }
}
