export interface VerifiedContractStorageSlot {
  slot_key_address: string;
  slot_nested_key_attestation_hash: string;
  value: string;
}

export interface TransitionNoticeExtensionBridgeHeadJobSucceeded {
  job_id: number;
  input_slot: number;
  input_block_number: number;
  input_store_hash: string;
  output_slot: number;
  output_block_number: number;
  output_store_hash: string;
  execution_state_root: string;
  contract_storage_slots: VerifiedContractStorageSlot[];
  elapsed_sec: number;
}

export const bridgeHeadJobSucceededExample: TransitionNoticeExtensionBridgeHeadJobSucceeded =
  {
    job_id: 0,
    input_slot: 4666560,
    input_block_number: 4125433,
    input_store_hash:
      '0xe96feb860e936822bc51c08e8e3d9f27cec687481436b88b45e00edf85858482',
    output_slot: 4666624,
    output_block_number: 4125482,
    output_store_hash:
      '0xa0d5d3858233c9b1d090b607633b9d5be1dee6a5af6114f481ae56618422eb1e',
    execution_state_root:
      '0x4403d71a726741c7a3cb75de772e0163ef421a6d98e17c3758207b30d981d284',
    contract_storage_slots: [
      {
        slot_key_address: '0xc7e910807dd2e3f49b34efe7133cfb684520da69',
        slot_nested_key_attestation_hash:
          '0x20cceb5b591e742c13fd7f3894f97139c964606f2928eefdc234e8a3a55c10b2',
        value: '0x1d1a94a2000',
      },
    ],
    elapsed_sec: 369.80310769,
  };
