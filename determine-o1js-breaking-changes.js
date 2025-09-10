import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(__filename);
const o1jsUtilsDir = path.join(rootDir, 'o1js-zk-utils');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');
const vkHashPath = path.join(
    o1jsUtilsDir,
    'src',
    'integrity',
    'EthVerifier.VkHash.json'
);

const versions = [
    '2.9.0',
    '2.8.0',
    '2.7.0',
    '2.6.0',
    '2.5.0',
    '2.4.0',
    '2.3.0'
];

async function main() {
    // Save original package.json and package-lock.json bytes
    const originalPackageJsonBytes = await fs.readFile(packageJsonPath);
    let originalPackageLockBytes = null;
    try {
        originalPackageLockBytes = await fs.readFile(packageLockPath);
    } catch (err) {
        console.warn('No package-lock.json found initially.');
    }

    const packageData = JSON.parse(originalPackageJsonBytes.toString());
    const vkHashMap = {};

    try {
        for (const version of versions) {
            console.log(`\nProcessing o1js version ${version}`);

            // Update package.json override
            packageData.overrides = { ...packageData.overrides, o1js: version };
            await fs.writeFile(
                packageJsonPath,
                JSON.stringify(packageData, null, 2),
                'utf-8'
            );
            console.log(`Updated package.json overrides.o1js to ${version}`);

            // Remove package-lock.json
            try {
                await fs.unlink(packageLockPath);
                console.log('Removed package-lock.json');
            } catch (err) {
                console.error('Failed to remove package-lock.json:', err);
            }

            // Remove root node_modules
            try {
                await fs.rm(path.join(rootDir, 'node_modules'), {
                    recursive: true,
                    force: true,
                });
                console.log('Removed root node_modules');
            } catch (err) {
                console.error('Failed to remove node_modules directory:', err);
            }

            // Remove o1js-utils node_modules
            try {
                await fs.rm(path.join(o1jsUtilsDir, 'node_modules'), {
                    recursive: true,
                    force: true,
                });
                console.log('Removed o1jsUtilsDir node_modules');
            } catch (err) {
                console.error(
                    'Failed to remove o1jsUtilsDir node_modules directory:',
                    err
                );
            }

            // Install dependencies
            console.log('Running npm install...');
            await execAsync('npm install', { cwd: rootDir });

            // Build o1js-zk-utils
            console.log('Building o1js-zk-utils...');
            await execAsync('npm run build', { cwd: o1jsUtilsDir });

            // Run bake-vk-hashes in o1js-zk-utils
            console.log('Running npm run bake-vk-hashes in o1js-zk-utils...');
            await execAsync('npm run bake-vk-hashes', { cwd: o1jsUtilsDir });

            // Read VkHash file
            const vkHashDataRaw = await fs.readFile(vkHashPath, 'utf-8');
            const vkHashData = JSON.parse(vkHashDataRaw);
            vkHashMap[version] = vkHashData;
            console.log(`Stored VkHash for version ${version}`);
        }
    } catch (err) {
        console.error('Error occurred during processing:', err);
        console.log(
            'Attempting to restore original package.json and package-lock.json...'
        );
        try {
            await fs.writeFile(packageJsonPath, originalPackageJsonBytes);
            console.log('Original package.json restored successfully.');
            if (originalPackageLockBytes) {
                await fs.writeFile(packageLockPath, originalPackageLockBytes);
                console.log(
                    'Original package-lock.json restored successfully.'
                );
            }
        } catch (restoreErr) {
            console.error('Failed to restore original files:', restoreErr);
        }
        throw err;
    }

    // Restore original package.json and package-lock.json exactly on success
    try {
        await fs.writeFile(packageJsonPath, originalPackageJsonBytes);
        console.log(
            'Restored original package.json after successful completion.'
        );
        if (originalPackageLockBytes) {
            await fs.writeFile(packageLockPath, originalPackageLockBytes);
            console.log(
                'Restored original package-lock.json after successful completion.'
            );
        }
    } catch (restoreErr) {
        console.error(
            'Failed to restore original files after success:',
            restoreErr
        );
        throw restoreErr;
    }

    console.log('\nVersion vs EthVerifier VkHash map:');
    console.log(vkHashMap);
}

main().catch((err) => {
    console.error('Script terminated with errors:', err);
    process.exit(1);
});
