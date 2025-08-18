// Simulate long import time due to top level async
await new Promise((res) => setTimeout(res, 10000));

export class EchoWorker {
    private id: string;
    constructor(id: string) {
        this.id = id;
    }

    async echo(req: { msg: string }): Promise<{ echoed: string }> {
        return { echoed: `Echo: ${req.msg}${this.id}` };
    }

    async shout(req: { msg: string }): Promise<{ upper: string }> {
        return { upper: req.msg.toUpperCase() };
    }
}
