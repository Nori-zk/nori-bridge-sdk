import { WebSocketServiceTopicSubscriptionMessage } from '@nori-zk/pts-types';
import { WebSocketSubject } from 'rxjs/webSocket';
import { getEthStateTopic$ } from './topic.js';
import { interval, map, switchMap, takeWhile, tap } from 'rxjs';

// TODO check if both takeWhiles are needed
export const waitForDepositFinalization$ = (
    depositBlockNumber: number,
    ethStateTopic$: ReturnType<typeof getEthStateTopic$>
) =>
    ethStateTopic$.pipe(
        tap(({ latest_finality_block_number }) => {
            console.log(
                'ethState received:',
                latest_finality_block_number,
                '<',
                depositBlockNumber
            );
        }),
        takeWhile(
            ({ latest_finality_block_number }) =>
                latest_finality_block_number < depositBlockNumber,
            true
        ),
        switchMap((ethState) => {
            const { latest_finality_slot, latest_finality_block_number } =
                ethState;
            const delta = latest_finality_slot - latest_finality_block_number;
            const depositSlot = depositBlockNumber + delta;
            const roundedSlot = Math.ceil(depositSlot / 32) * 32;
            const targetBlock = roundedSlot - delta;
            const blocksRemaining = targetBlock - latest_finality_block_number;
            const timeToWait = Math.max(0, blocksRemaining * 12);
            console.log(
                'got here',
                latest_finality_block_number < depositBlockNumber
            );
            return interval(1000).pipe(
                takeWhile(
                    () => latest_finality_block_number < depositBlockNumber,
                    true
                ),
                map((elapsedSec) => {
                    /*console.log(
                        'hmmmmmmmm ',
                        latest_finality_block_number,
                        depositBlockNumber,
                        latest_finality_block_number < depositBlockNumber
                    );*/
                    return timeToWait - (elapsedSec % 384);
                }) // The modulo here is to make it start again at 384 if it hits zero
            );
        })
    );
