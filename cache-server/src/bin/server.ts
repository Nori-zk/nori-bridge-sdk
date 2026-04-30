import http from 'http';
import fs from 'fs';
import path, { resolve } from 'path';
import { fileURLToPath } from 'url';
import { Logger, LogPrinter } from 'esm-iso-logger';

new LogPrinter('CacheServer');
const logger = new Logger('StaticServer');

/**
 * Static file server for the o1js compile cache. Streams responses
 * with `pipe()` so large prover-key files (hundreds of MB) don't
 * have to be buffered in server memory before sending — that was
 * killing requests under uWebSockets, which silently dropped
 * connections mid-transfer for files >~100 MB.
 *
 * Endpoints: any GET on `/<contract>/<file>` returns the cache file
 * with a permissive CORS header. `.header` files are served as
 * `text/plain`; everything else is `application/octet-stream`.
 */
function createServer(baseDir: string, port: number) {
    const server = http.createServer((req, res) => {
        const url = req.url ?? '/';
        const requested = url.split('?')[0];
        const filePath = path.normalize(path.join(baseDir, requested));
        if (!filePath.startsWith(baseDir)) {
            res.writeHead(403, {
                'Content-Type': 'text/plain',
                'Access-Control-Allow-Origin': '*',
            });
            res.end('Forbidden');
            return;
        }
        fs.stat(filePath, (statErr, stat) => {
            if (statErr || !stat.isFile()) {
                res.writeHead(404, {
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end('Not Found');
                return;
            }
            const contentType = filePath.endsWith('.header')
                ? 'text/plain'
                : 'application/octet-stream';
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': String(stat.size),
                'Access-Control-Allow-Origin': '*',
                'Cross-Origin-Resource-Policy': 'cross-origin',
                'Cache-Control': 'no-store',
            });
            const stream = fs.createReadStream(filePath);
            stream.on('error', (err) => {
                logger.error(`Stream error for ${filePath}: ${err.message}`);
                res.destroy();
            });
            stream.pipe(res);
        });
    });

    server.listen(port, () => {
        logger.log(
            `Server started on port ${port}. Serving files from '${baseDir}' directory.`
        );
    });
    return server;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// TypeScript flattens src/bin/server.ts -> build/server.js (because
// `bin` is the only src subdir), so at runtime __dirname is
// `.../cache-server/build`. Cache lives at `.../cache-server/cache`.
const cacheDir = resolve(__dirname, '..', 'cache');
const port = 4210;

createServer(cacheDir, port);
