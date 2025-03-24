"use client";

import React from "react";
import { toast as sonnerToast } from "sonner";
import Toast, { ToastProps } from "@/components/ui/Toast";

export function toast(toast: Omit<ToastProps, "id">) {
  return sonnerToast.custom((id) => (
    <Toast
      id={id}
      title={toast.title}
      description={toast.description}
      button={{
        label: toast.button.label,
        onClick: toast.button.onClick,
      }}
    />
  ));
}
