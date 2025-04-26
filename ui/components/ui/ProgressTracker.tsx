import ProgressTrackerStep from "./ProgressTrackerStep";
import { progressSteps } from "@/static_data";

const ProgressTracker = () => {
  return (
    <div className="flex flex-row w-full justify-between items-center">
      {progressSteps.map((step, index) => (
        <ProgressTrackerStep
          key={index}
          title={step.title}
          isActive={step.isActive}
          isCompleted={step.isCompleted}
        />
      ))}
    </div>
  );
};

export default ProgressTracker;
