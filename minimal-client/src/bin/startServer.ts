#!/usr/bin/env node
/**
 * Standalone script to start the dev server with staging env proxies.
 * Usage: npx tsx src/bin/startServer.ts [port]
 */
import { startServer } from '../test-utils/browserTestRunnerUtils.js';
import { getStagingEnv } from '@nori-zk/mina-token-bridge/node';

const port = Number(process.argv[2]) || 4003;
const stagingEnv = getStagingEnv();
const rpcPath = new URL(stagingEnv.MINA_RPC_NETWORK_URL).pathname;

const { url } = await startServer(port);
const base = `http://localhost:${port}`;
console.log(`Dev server ready at ${url}`);
console.log(`Routes:`);
console.log(`  Static files:    ${base}/`);
console.log(`  Mina RPC proxy:  ${base}${rpcPath} -> ${stagingEnv.MINA_RPC_NETWORK_URL}`);
console.log(`  Archive proxy:   ${base}/archive -> ${stagingEnv.MINA_ARCHIVE_RPC_URL}`);
console.log(`  PCS proxy:       ${base}/converted-consensus-mpt-proofs -> ${stagingEnv.NORI_PCS_URL}`);
console.log('Press Ctrl+C to stop.');
