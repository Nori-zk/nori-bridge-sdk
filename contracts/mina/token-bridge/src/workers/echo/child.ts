import { WorkerChildBase, WorkerChildInfer, WorkerParentLike } from '../../worker/types.js';

export class EchoWorkerChild extends WorkerChildBase implements WorkerChildInfer<EchoWorkerChild> {
  constructor(parent: WorkerParentLike) {
    super(parent);
  }

  async echo(req: { msg: string }): Promise<{ echoed: string }> {
    return { echoed: `Echo: ${req.msg}` };
  }

  async shout(req: { msg: string }): Promise<{ upper: string }> {
    return { upper: req.msg.toUpperCase() };
  }
}