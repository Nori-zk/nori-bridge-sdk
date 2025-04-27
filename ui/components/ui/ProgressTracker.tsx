"use client";

import { motion } from "framer-motion";
import ProgressTrackerStep from "./ProgressTrackerStep"; // We'll build this next
import ProgressTrackerConnector from "./ProgressTrackerConnector"; // We'll build this too
import { ProgressTrackerStepProps } from "./ProgressTrackerStep";

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
