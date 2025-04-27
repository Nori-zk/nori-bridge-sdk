"use client";

import { motion } from "framer-motion";

interface ConnectorProps {
  isCompleted: boolean;
  isNextActive: boolean;
}

const ProgressTrackerConnector = ({
  isCompleted,
  isNextActive,
}: ConnectorProps) => {
  const color =
    isCompleted || isNextActive ? "var(--lightGreen)" : "var(--connectedGreen)";

  return (
    <motion.div
      initial={{ width: 0 }}
      animate={{ width: "42px" }}
      transition={{ duration: 0.5 }}
      className="flex justify-center items-center"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 72 16"
        className="w-[50px] h-[10px]"
      >
        <path
          d="M0 0.5C1.35849 6.125 21.8513 7.0625 36 7.0625C50.1487 7.0625 70.6415 6.125 72 0.5V15.5C70.6415 9.875 50.1487 8.9375 36 8.9375C21.8513 8.9375 1.35849 9.875 0 15.5V0.5Z"
          fill={color}
        />
      </svg>
    </motion.div>
  );
};

export default ProgressTrackerConnector;
