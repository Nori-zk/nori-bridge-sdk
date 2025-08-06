import { deployTokenController } from '../NoriTokenControllerDeploy.js';

deployTokenController()
    .then(console.log)
    .catch((e: unknown) => {
        const error = e as Error;
        console.error(`Deployment failed: ${error.stack}`);
        process.exit(1);
    });
