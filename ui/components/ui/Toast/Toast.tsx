import React from "react";
import { toast as sonnerToast } from "sonner";
import { motion } from "framer-motion";

export type ToastProps = {
  id: string | number;
  title: string;
  description: string;
  button?: {
    label: string;
    onClick: () => void;
  };
};

const Toast = (props: ToastProps) => {
  const { title, description, button, id } = props;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex rounded-lg bg-veryDarkRed text-white shadow-lg ring-1 ring-darkRed w-full md:max-w-[364px] items-center p-3"
    >
      <div className="flex flex-1 items-center">
        <div className="w-full">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-sm text-gray-300">{description}</p>
        </div>
      </div>
      {button && (
        <div className="ml-5 shrink-0 rounded-md">
          <button
            className="rounded bg-darkRed px-3 py-1 text-sm font-semibold text-white hover:bg-lightRed transition"
            onClick={() => {
              button.onClick();
              sonnerToast.dismiss(id);
            }}
          >
            {button.label}
          </button>{" "}
        </div>
      )}
    </motion.div>
  );
};

export default Toast;
