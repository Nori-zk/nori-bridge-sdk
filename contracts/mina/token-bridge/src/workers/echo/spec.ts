/**
 * Specification of the methods exposed by EchoWorker
 * for parent proxying.
 */
export const workerSpec = {
    /**
     * Proxy method for echoing a message.
     */
    echo: async (req: { msg: string }) => ({ echoed: '' }),

    /**
     * Proxy method for converting a message to uppercase.
     */
    shout: async (req: { msg: string }) => ({ upper: '' }),
} as const;
