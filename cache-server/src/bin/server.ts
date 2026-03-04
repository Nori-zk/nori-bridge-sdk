import { App, type HttpResponse } from 'uWebSockets.js';
import path, { resolve } from 'path';
import { access, constants, readFile } from 'fs';
import { fileURLToPath } from 'url';
import { Logger, LogPrinter } from 'esm-iso-logger';

new LogPrinter('CacheServer');
const logger = new Logger('StaticServer');

export class StaticServer {
    private port: number;
    private baseDir: string;

    constructor(port: number, baseDir: string) {
        this.port = port;
        this.baseDir = baseDir;
    }

    private serveStaticFile(requestedPath: string, res: HttpResponse) {
        let aborted = false;
        res.onAborted(() => {
            aborted = true;
            logger.warn('Request aborted by client');
        });
        const filePath = path.join(this.baseDir, requestedPath);

        access(filePath, constants.F_OK, (err) => {
            if (aborted) return;
            if (err) {
                res.cork(() => {
                    res.writeStatus('404 Not Found')
                        .writeHeader('Content-Type', 'text/plain')
                        .writeHeader('Access-Control-Allow-Origin', '*')
                        .end('Not Found');
                });
                return;
            }

            readFile(filePath, (err, fileData) => {
                res.cork(() => {
                    if (aborted) return;
                    if (err) {
                        res.writeStatus('500 Internal Server Error')
                            .writeHeader('Content-Type', 'text/plain')
                            .writeHeader('Access-Control-Allow-Origin', '*')
                            .end('Error reading file');
                        return;
                    }

                    const contentType = filePath.endsWith('.header')
                        ? 'text/plain'
                        : 'application/octet-stream';

                    res.writeHeader('Access-Control-Allow-Origin', '*');
                    res.writeStatus('200 OK')
                        .writeHeader('Content-Type', contentType)
                        .end(fileData);
                });
            });
        });
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const app = App();

            app.any('/*', (res, req) => {
                const url = req.getUrl();
                this.serveStaticFile(url, res);
            });

            app.listen(this.port, (token) => {
                if (token) {
                    logger.log(
                        `Server started on port ${this.port}. Serving files from '${this.baseDir}' directory.`
                    );
                    resolve();
                } else {
                    logger.error(
                        `Server failed to start on port ${this.port}`
                    );
                    reject();
                }
            });
        });
    }
}
export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

const cacheDir = resolve(__dirname, '..', '..', '..', 'cache');
const port = 4210;

const server = new StaticServer(port, cacheDir);
server.start().catch((e) => {
    logger.fatal(`Server errored: ${e.stack}`);
});
