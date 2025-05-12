import React from "react";
import { toast as sonnerToast } from "sonner";
import Toast, { ToastProps } from "@/components/ui/Toast/Toast";

type ToastOptions = Omit<ToastProps, "id">;

export function useToast({ button, ...rest }: ToastOptions) {
  return sonnerToast.custom(
    (id) => (
      <Toast
        id={id}
        {...rest}
        button={
          button
            ? {
                label: button.label,
                onClick: button.onClick || (() => {}),
              }
            : undefined
        }
      />
    ),
    {
      duration: 5000,
    }
  );
}
