import React from "react";
import { toast as sonnerToast } from "sonner";
import Toast, { ToastProps } from "@/components/ui/Toast/Toast";

type ToastType = "error" | "notification";

type ToastOptions = Omit<ToastProps, "id">;

export function useToast(defaultOptions?: ToastOptions) {
  return (options?: ToastOptions) => {
    const mergedOptions = {
      type: "notification" as ToastType,
      title: "Default Title", // Fallback for title
      description: "Default Description", // Fallback for description

      ...(options || defaultOptions || {}),
    };

    return sonnerToast.custom((id) => <Toast id={id} {...mergedOptions} />, {
      duration: 5000,
    });
  };
}
