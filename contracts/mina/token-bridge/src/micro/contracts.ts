import { FungibleToken } from './TokenBase.js';
import {
    NoriTokenController,
} from './NoriTokenController.js';

FungibleToken.AdminContract = NoriTokenController;
NoriTokenController.TokenContract = FungibleToken;

export {
    FungibleToken,
    NoriTokenController,
};
