import { deployTokenController } from '../NoriTokenControllerDeploy.js';

deployTokenController()
    .then(console.log)
    .catch((error) => {
        console.error(`Deployment failed: ${error}`);
        process.exit(1);
    });
