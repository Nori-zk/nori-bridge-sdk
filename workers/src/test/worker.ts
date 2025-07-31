export class EchoWorker {
  async echo(req: { msg: string }): Promise<{ echoed: string }> {
    return { echoed: `Echo: ${req.msg}` };
  }

  async shout(req: { msg: string }): Promise<{ upper: string }> {
    return { upper: req.msg.toUpperCase() };
  }
}