import { WorkerParentBase, WorkerChildLike } from '../../worker/types.js';

export class EchoWorkerParent extends WorkerParentBase {
  constructor(child: WorkerChildLike) {
    super(child);
  }

  echo(req: { msg: string }): Promise<{ echoed: string }> {
    return this.call('echo', req);
  }

  shout(req: { msg: string }): Promise<{ upper: string }> {
    return this.call('shout', req);
  }
}