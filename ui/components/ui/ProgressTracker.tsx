"use client";

import ProgressTrackerStep from "./ProgressTrackerStep.tsx";
import ProgressTrackerConnector from "./ProgressTrackerConnector.tsx";
import { ProgressTrackerStepProps } from "./ProgressTrackerStep.tsx";

interface ProgressTrackerProps {
  steps: ProgressTrackerStepProps[];
}

const ProgressTracker = ({ steps }: ProgressTrackerProps) => {
  return (
    <div className="flex w-full items-center justify-between">
      {steps.map((step, index) => (
        <div key={index} className="flex items-center">
          <ProgressTrackerStep {...step} />
          {index < steps.length - 1 && (
            <ProgressTrackerConnector
              isCompleted={steps[index].isCompleted}
              isNextActive={steps[index + 1].isActive}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export default ProgressTracker;
