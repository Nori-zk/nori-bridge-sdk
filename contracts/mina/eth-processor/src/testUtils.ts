export async function getNewMinaLiteNetAccountSK(): Promise<string> {
    const { request } = await import('http');
    return new Promise((resolve, reject) => {
        const req = request(
            {
                host: 'localhost',
                port: 8181,
                path: '/acquire-account',
                method: 'GET',
            },
            (res) => {
                res.setEncoding('utf8');
                let buffer = '';
                res.on('data', (data) => (buffer += data));
                res.on('end', () => {
                    try {
                        const data = JSON.parse(buffer);
                        console.log(`Received new sk from acquire account.`);
                        resolve(data.sk);
                    } catch (e) {
                        const error = e as unknown as Error;
                        console.error(
                            `Failed to retreive a new account:\n${String(
                                error.stack
                            )}`
                        );
                        reject(error);
                    }
                });
            }
        );
        req.on('error', (err) => reject(err));
        req.end();
    });
}