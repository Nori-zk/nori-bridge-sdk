"use client";
import { motion } from "framer-motion";

export interface ProgressTrackerStepProps {
  title: string;
  isActive: boolean;
  isCompleted: boolean;
}

const ProgressTrackerStep = ({
  title,
  isActive,
  isCompleted,
}: ProgressTrackerStepProps) => {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className={`
        w-[160px]
        transition-colors duration-500 ease-in-out rounded-full text-center 
        text-sm py-2 px-3 rounded-md
        ${
          isCompleted
            ? "bg-lightGreen text-darkGreen"
            : "bg-connectedGreen text-white"
        }
        ${isActive ? "border border-lightGreen" : "border border-transparent"}
      `}
    >
      {title}
    </motion.div>
  );
};

export default ProgressTrackerStep;
