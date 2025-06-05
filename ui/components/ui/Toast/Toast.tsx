import React from "react";
import { toast as sonnerToast } from "sonner";
import { motion } from "framer-motion";

export type ToastProps = {
  id: string | number;
  title: string;
  description: string;
  type?: "error" | "notification";
  button?: {
    label: string;
    onClick: () => void;
  };
};

const Toast = (props: ToastProps) => {
  const { title, description, type = "notification", button, id } = props;

  const baseStyles =
    "flex rounded-lg shadow-lg ring-1 w-full md:max-w-[364px] items-center p-3";
  const typeStyles = {
    error: "bg-veryDarkRed text-white ring-darkRed",
    notification: "bg-veryDarkGreen text-white ring-blue-500",
  };

  const className = `${baseStyles} ${typeStyles[type]}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={className}
      data-testid={id}
    >
      <div className="flex flex-1 items-center">
        <div className="w-full">
          <p data-testid={`toast-title-${id}`} className="text-sm font-medium">
            {title}
          </p>
          <p
            data-testid={`toast-description-${id}`}
            className="mt-1 text-sm text-gray-300"
          >
            {description}
          </p>
        </div>
      </div>
      {button && (
        <div className="ml-5 shrink-0 rounded-md">
          <button
            className={`rounded px-3 py-1 text-sm font-semibold text-white transition ${
              type === "error"
                ? "bg-darkRed hover:bg-lightRed"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
            onClick={() => {
              button.onClick();
              sonnerToast.dismiss(id);
            }}
          >
            {button.label}
          </button>
        </div>
      )}
    </motion.div>
  );
};

export default Toast;
