import { echoWorkerParent } from './node/parent.js';

afterAll(() => {
  echoWorkerParent.terminate();
});

describe('EchoWorker', () => {
  it('should_echo_message', async () => {
    const res = await echoWorkerParent.echo({ msg: 'hello' });
    expect(res).toEqual({ echoed: 'Echo: hello' });
  });

  it('should_shout_message', async () => {
    const res = await echoWorkerParent.shout({ msg: 'hello' });
    expect(res).toEqual({ upper: 'HELLO' });
  });
});
