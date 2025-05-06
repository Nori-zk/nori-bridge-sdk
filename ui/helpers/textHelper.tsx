// System Notices
export enum SystemNoticeMessageType {
  // Bridge Head
  BridgeHeadStarted = "BridgeHeadStarted",
  BridgeHeadHeartbeat = "BridgeHeadHeartbeat",
  // Proof converter
  ProofConversionStarted = "ProofConversionStarted",
  ProofConversionHeartbeat = "ProofConversionHeartbeat",
  // Eth Processor
  EthProcessorStarted = "EthProcessorStarted",
  EthProcessorHeartbeat = "EthProcessorHeartbeat",
}

// Base TransitionNotice message types
export enum TransitionNoticeMessageType {
  // Bridge Head
  BridgeHeadStarted = "BridgeHeadStarted",
  BridgeHeadWarning = "BridgeHeadWarning",
  BridgeHeadJobCreated = "BridgeHeadJobCreated",
  BridgeHeadJobSucceeded = "BridgeHeadJobSucceeded",
  BridgeHeadJobFailed = "BridgeHeadJobFailed",
  BridgeHeadFinalityTransitionDetected = "BridgeHeadFinalityTransitionDetected",
  BridgeHeadAdvanced = "BridgeHeadAdvanced",
  // Proof converter
  ProofConversionStarted = "ProofConversionStarted",
  ProofConversionJobReceived = "ProofConversionJobReceived",
  ProofConversionJobSucceeded = "ProofConversionJobSucceeded",
  ProofConversionJobFailed = "ProofConversionJobFailed",
  ProofConversionComputationalPlanStarted = "ProofConversionComputationalPlanStarted",
  ProofConversionComputationalPlanInitCompleted = "ProofConversionComputationalPlanInitCompleted",
  ProofConversionComputationalPlanStagePrequisiteDetermined = "ProofConversionComputationalPlanStagePrequisiteDetermined",
  ProofConversionComputationalPlanStageExecutionStarted = "ProofConversionComputationalPlanStageExecutionStarted",
  ProofConversionComputationalPlanStageExecutionSubStageExecutionCompleted = "ProofConversionComputationalPlanStageExecutionSubStageExecutionCompleted",
  ProofConversionComputationalPlanStageExecutionCompleted = "ProofConversionComputationalPlanStageExecutionCompleted",
  ProofConversionComputationalPlanThenCompleted = "ProofConversionComputationalPlanThenCompleted",
  ProofConversionComputationalPlanFinallyCompleted = "ProofConversionComputationalPlanFinallyCompleted",
  // Eth Processor
  EthProcessorStarted = "EthProcessorStarted",
  // Deploy
  EthProcessorDeployContractRequested = "EthProcessorDeployContractRequested",
  EthProcessorDeployContractSucceeded = "EthProcessorDeployContractSucceeded",
  // Proof
  EthProcessorProofRequest = "EthProcessorProofRequest",
  EthProcessorProofSucceeded = "EthProcessorProofSucceeded",
  EthProcessorProofFailed = "EthProcessorProofFailed",
  // Tx submission
  EthProcessorTransactionSubmitting = "EthProcessorTransactionSubmitting",
  EthProcessorTransactionSubmitSucceeded = "EthProcessorTransactionSubmitSucceeded",
  EthProcessorTransactionSubmitFailed = "EthProcessorTransactionSubmitFailed",
  // Tx finalization
  EthProcessorTransactionFinalizationSucceeded = "EthProcessorTransactionFinalizationSucceeded",
  EthProcessorTransactionFinalizationFailed = "EthProcessorTransactionFinalizationFailed",
}

interface ProcessCmd {
  cmd: string;
  args: string[];
  printableArgs?: number[];
}

interface NoticeBase {
  message_type: SystemNoticeMessageType | TransitionNoticeMessageType;
  datetime_iso: string;
  extension: Record<string, any> | null;
}

export function processCmdToString(processCmd: ProcessCmd): string {
  const { cmd, args, printableArgs } = processCmd;
  if (!args.length) return cmd;
  if (!printableArgs) {
    return `${cmd} ${args.join(" ")}`;
  }
  const filteredPrintableArgs = args.filter((_, idx) =>
    printableArgs.includes(idx)
  );
  return filteredPrintableArgs.length < args.length
    ? `${cmd} ${filteredPrintableArgs.join(" ")}...`
    : `${cmd} ${args.join(" ")}`;
}

export function defaultExtensionToString(
  extension: Record<string, any> | null
): string | null {
  if (extension === null) return null;
  return Object.entries(extension)
    .map(([key, value]) => {
      return `${key}: '${value}'`;
    })
    .join(", ");
}

export function defaultNoticeToString(notice: NoticeBase): string {
  const ext = defaultExtensionToString(notice.extension);
  // prettier-ignore
  if (ext === null)
      return `[${notice.datetime_iso}] ${notice.message_type}`;
    else
      // prettier-ignore
      return `[${notice.datetime_iso}] ${notice.message_type}: ${defaultExtensionToString(notice.extension)}`;
}

export function noticeToText(notice: NoticeBase): string | string[] | null {
  switch (notice.message_type) {
    // Simple cases
    case TransitionNoticeMessageType.BridgeHeadStarted:
    case TransitionNoticeMessageType.BridgeHeadWarning:
    case TransitionNoticeMessageType.BridgeHeadJobCreated:
    case TransitionNoticeMessageType.BridgeHeadJobSucceeded:
    case TransitionNoticeMessageType.BridgeHeadJobFailed:
    case TransitionNoticeMessageType.BridgeHeadFinalityTransitionDetected:
    case TransitionNoticeMessageType.BridgeHeadAdvanced:
    case TransitionNoticeMessageType.EthProcessorStarted:
    case TransitionNoticeMessageType.EthProcessorDeployContractRequested:
    case TransitionNoticeMessageType.EthProcessorDeployContractSucceeded:
    case TransitionNoticeMessageType.EthProcessorProofRequest:
    case TransitionNoticeMessageType.EthProcessorProofSucceeded:
    case TransitionNoticeMessageType.EthProcessorProofFailed:
    case TransitionNoticeMessageType.EthProcessorTransactionSubmitting:
    case TransitionNoticeMessageType.EthProcessorTransactionSubmitSucceeded:
    case TransitionNoticeMessageType.EthProcessorTransactionSubmitFailed:
    case TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded:
    case TransitionNoticeMessageType.EthProcessorTransactionFinalizationFailed:
    case TransitionNoticeMessageType.ProofConversionStarted:
    case SystemNoticeMessageType.BridgeHeadHeartbeat:
    case SystemNoticeMessageType.ProofConversionHeartbeat:
    case SystemNoticeMessageType.EthProcessorHeartbeat:
    case TransitionNoticeMessageType.ProofConversionJobReceived:
    case TransitionNoticeMessageType.ProofConversionJobSucceeded:
    case TransitionNoticeMessageType.ProofConversionJobFailed:
      return defaultNoticeToString(notice);
    // Complex cases
    case TransitionNoticeMessageType.ProofConversionComputationalPlanThenCompleted:
    case TransitionNoticeMessageType.ProofConversionComputationalPlanFinallyCompleted: {
      const castNotice = notice;
      const extensionClone = { ...castNotice.extension };
      // prettier-ignore
      return `[${notice.datetime_iso}] ${notice.message_type} | Plan '${castNotice.extension?.plan_name}': ${defaultExtensionToString(extensionClone)}`;
    }
    case TransitionNoticeMessageType.ProofConversionComputationalPlanStarted:
    case TransitionNoticeMessageType.ProofConversionComputationalPlanInitCompleted:
    case TransitionNoticeMessageType.ProofConversionComputationalPlanStagePrequisiteDetermined: {
      const castNotice = notice;
      const extensionClone = { ...castNotice.extension };
      if ("stages" in extensionClone) delete extensionClone["stages"];
      if ("input" in extensionClone) delete extensionClone["input"];
      if ("plan_name" in extensionClone) delete extensionClone["plan_name"];
      // prettier-ignore
      const outputText = `[${notice.datetime_iso}] ${notice.message_type} | Plan '${castNotice.extension?.plan_name}': ${defaultExtensionToString(extensionClone)}`;
      return outputText;
    }
    case TransitionNoticeMessageType.ProofConversionComputationalPlanStageExecutionStarted: {
      const castNotice = notice as NoticeBase & {
        extension: {
          stage_count: number;
          stage_idx: number;
          stages: Array<{ name: string; type: string }>;
          plan_name: string;
          substage_count?: number;
          cmds?: ProcessCmd[];
          cmd?: ProcessCmd;
        };
      };
      const stageCount = castNotice.extension.stage_count;
      const stageIdx = castNotice.extension.stage_idx;
      const stageName = castNotice.extension.stages[stageIdx].name;
      const stageType = castNotice.extension.stages[stageIdx].type;
      // prettier-ignore
      let outputText = `[${notice.datetime_iso}] ${notice.message_type} | Plan '${castNotice.extension.plan_name}' | Stage(${stageType}) '${stageName}' ${stageIdx + 1}/${stageCount}`;
      if ("substage_count" in castNotice.extension) {
        // stageType === 'parallel-cmd'
        // prettier-ignore
        outputText += ` | Substage 0/${castNotice.extension.substage_count}`;
        return [
          outputText,
          ...(castNotice.extension.cmds?.map((cmd) =>
            processCmdToString(cmd)
          ) || []),
        ];
      } else if ("cmd" in castNotice.extension) {
        // stageType === 'serial-cmd'
        if (castNotice.extension.cmd) {
          return [outputText, processCmdToString(castNotice.extension.cmd)];
        }
      }
      return outputText;
    }
    case TransitionNoticeMessageType.ProofConversionComputationalPlanStageExecutionSubStageExecutionCompleted: {
      const castNotice = notice as NoticeBase & {
        extension: {
          stage_count: number;
          stage_idx: number;
          stages: Array<{ name: string; type: string }>;
          plan_name: string;
          substage_count?: number;
          substages_completed?: number;
          cmd?: ProcessCmd;
        };
      };
      const stageCount = castNotice.extension.stage_count;
      const stageIdx = castNotice.extension.stage_idx;
      const stageName = castNotice.extension.stages[stageIdx].name;
      const stageType = castNotice.extension.stages[stageIdx].type;
      // prettier-ignore
      let outputText = `[${notice.datetime_iso}] ${notice.message_type} | Plan '${castNotice.extension.plan_name}' | Stage(${stageType}) '${stageName}' ${stageIdx + 1}/${stageCount}`;
      if ("substage_count" in castNotice.extension) {
        // stageType === 'parallel-cmd'
        // prettier-ignore
        outputText += ` | Substage ${castNotice.extension.substages_completed}/${castNotice.extension.substage_count}`;
        return [outputText];
      } else if ("cmd" in castNotice.extension) {
        // stageType === 'serial-cmd'
        if (castNotice.extension.cmd) {
          return [outputText, processCmdToString(castNotice.extension.cmd)];
        }
      }
      return outputText;
    }
    case TransitionNoticeMessageType.ProofConversionComputationalPlanStageExecutionCompleted: {
      const castNotice = notice as NoticeBase & {
        extension: {
          stage_count: number;
          stage_idx: number;
          stages: Array<{ name: string; type: string }>;
          plan_name: string;
        };
      };
      const stageCount = castNotice.extension.stage_count;
      const stageIdx = castNotice.extension.stage_idx;
      const stageName = castNotice.extension.stages[stageIdx].name;
      const stageType = castNotice.extension.stages[stageIdx].type;
      // prettier-ignore
      let outputText = `[${notice.datetime_iso}] ${notice.message_type} | Plan '${castNotice.extension.plan_name}' | Stage(${stageType}) '${stageName}' ${stageIdx + 1}/${stageCount}`;
      return outputText;
    }
    default: {
      console.warn(`Unhandled notice message type: ${notice["message_type"]}`);
      return null;
    }
  }
}
