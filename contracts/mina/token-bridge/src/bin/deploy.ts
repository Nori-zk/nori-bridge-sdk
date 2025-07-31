import { main } from '../NoriTokenControllerDeploy.js';

main()
    .then(console.log)
    .catch((error) => {
        console.error(`Deployment failed: ${error}`);
        process.exit(1);
    });
