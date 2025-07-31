import { deployTokenController } from "./NoriTokenControllerDeploy.js"

describe('NoriTokenControllerDeploy', () => {
    test('nori_token_controller_deploy_mock', async () => {
        process.env.MOCK = 'true';
        await deployTokenController();
    })
})