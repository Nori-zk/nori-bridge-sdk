import React from "react";
import { toast as sonnerToast } from "sonner";
import Toast, { ToastProps } from "@/components/ui/Toast/Toast";

type ToastOptions = Omit<ToastProps, "id">;

export function useToast(defaultOptions?: ToastOptions) {
  return (options?: ToastOptions) => {
    const mergedOptions = {
      title: "Default Title", // Fallback for title
      description: "Default Description", // Fallback for description
      ...(options || defaultOptions || {}),
    };

    return sonnerToast.custom(
      (id) => (
        <Toast
          id={id}
          {...mergedOptions}
          button={
            options?.button || defaultOptions?.button
              ? {
                  label: (options?.button || defaultOptions?.button)!.label,
                  onClick:
                    (options?.button || defaultOptions?.button)!.onClick ||
                    (() => {}),
                }
              : undefined
          }
        />
      ),
      {
        duration: 5000,
      }
    );
  };
}
