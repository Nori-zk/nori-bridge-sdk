/**
 * Simple worker demonstrating basic request/response behavior.
 */
export class EchoWorker {
    /**
     * Echoes back the input message.
     * @param req - Object containing the message to echo
     * @returns Object containing the echoed message
     */
    async echo(req: { msg: string }): Promise<{ echoed: string }> {
        return { echoed: `Echo: ${req.msg}` };
    }

    /**
     * Converts the input message to uppercase.
     * @param req - Object containing the message to shout
     * @returns Object containing the uppercase message
     */
    async shout(req: { msg: string }): Promise<{ upper: string }> {
        return { upper: req.msg.toUpperCase() };
    }
}

/**
 * Proxy spec for EchoWorker.
 */
export const workerSpec = {
    echo: async (req: { msg: string }) => ({ echoed: '' }),
    shout: async (req: { msg: string }) => ({ upper: '' }),
} as const;
