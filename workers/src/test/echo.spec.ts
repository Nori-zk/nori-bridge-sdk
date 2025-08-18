import { EchoWorkerParent } from './node/parent.js';

describe('EchoWorker', () => {
    let echoWorkerParent: InstanceType<typeof EchoWorkerParent>;

    beforeAll(async () => {
        echoWorkerParent = new EchoWorkerParent('test');
        // Wait until ready
        await echoWorkerParent.ready;
        console.log('[EchoWorkerParent] Worker is ready');
    });

    afterAll(() => {
        echoWorkerParent.terminate();
    });

    it('should_echo_message', async () => {
        const res = await echoWorkerParent.echo({ msg: 'hello' });
        expect(res).toEqual({ echoed: 'Echo: hellotest' });
    });

    it('should_shout_message', async () => {
        const res = await echoWorkerParent.shout({ msg: 'hello' });
        expect(res).toEqual({ upper: 'HELLO' });
    });
});
