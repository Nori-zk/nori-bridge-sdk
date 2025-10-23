// Move this to o1js utils its useful!
import {
    ZKCacheWithProgram,
    ZKCacheLayout,
    FileSystemCacheConfig,
    CacheType,
    compileAndOptionallyVerifyContracts,
} from '@nori-zk/o1js-zk-utils';
import path from 'path';
import fs from 'fs/promises';
import { cacheFactory } from '@nori-zk/o1js-zk-utils';

export async function cacheBuilder(
    caches: ZKCacheWithProgram[],
    cacheDir: string,
    layoutsDir: string
) {
    // Clear cache and layouts folder
    await fs.rm(cacheDir, { recursive: true, force: true });
    await fs.mkdir(layoutsDir, { recursive: true });

    const layoutNames: string[] = [];

    for (const cache of caches) {
        const { name, program } = cache;
        let integrityHash = cache.integrityHash;
        const cacheSubDir = path.resolve(cacheDir, name);
        await fs.mkdir(cacheSubDir, { recursive: true });

        const fileSystemCacheConfig: FileSystemCacheConfig = {
            type: CacheType.FileSystem,
            dir: cacheSubDir,
        };

        const fileSystemCache = await cacheFactory(fileSystemCacheConfig);

        const vks = await compileAndOptionallyVerifyContracts(
            console,
            [{ name, program, integrityHash }],
            fileSystemCache
        );

        if (!integrityHash) {
            integrityHash =
                vks[`${name}VerificationKey`].hash.toBigInt.toString();
        }

        const files = (await fs.readdir(cacheSubDir)).filter(
            (f) => !f.endsWith('.header')
        );
        const layout: ZKCacheLayout = { name, integrityHash, files };

        // Save individual JSON
        const jsonPath = path.resolve(layoutsDir, `${name}.json`);
        await fs.writeFile(jsonPath, JSON.stringify(layout, null, 2), 'utf-8');

        // Save corresponding TS file
        const tsPath = path.resolve(layoutsDir, `${name}.ts`);
        const tsContent = `import ${name}Json from './${name}.json' with { type: "json" };
import { ZKCacheLayout } from '@nori-zk/o1js-zk-utils';

export const ${name}CacheLayout: ZKCacheLayout = ${name}Json;
`;
        await fs.writeFile(tsPath, tsContent, 'utf-8');

        layoutNames.push(name);
    }

    // Create index.ts
    const indexTsPath = path.resolve(layoutsDir, 'index.ts');
    const indexContent =
        `import { ZKCacheLayout } from '@nori-zk/o1js-zk-utils';\n` +
        layoutNames
            .map((name) => `import { ${name}CacheLayout } from './${name}.js';`)
            .join('\n') +
        '\n' +
        layoutNames
            .map((name) => `export { ${name}CacheLayout } from './${name}.js';`)
            .join('\n') +
        `\n\nexport const allCacheLayouts: ZKCacheLayout[] = [${layoutNames
            .map((n) => n + 'CacheLayout')
            .join(', ')}];\n`;

    await fs.writeFile(indexTsPath, indexContent, 'utf-8');
}
