import { deployTokenController } from '../deploy.js';

deployTokenController()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
        const error = e as Error;
        console.error(`Deployment failed: ${error.stack}`);
        process.exit(1);
    });
