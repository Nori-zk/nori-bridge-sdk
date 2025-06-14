"use client";
import { createContext, useContext, useReducer } from "react";
import {
  progressReducer,
  initialState,
} from "@/providers/reducers/ProgressReducer.tsx";
import { ProgressState, ProgressAction } from "@/types/types.ts";

interface ProgressContextType {
  state: ProgressState;
  dispatch: React.Dispatch<ProgressAction>;
}

const ProgressContext = createContext<ProgressContextType | undefined>(
  undefined
);

export const useProgress = (): ProgressContextType => {
  const context = useContext(ProgressContext);
  if (!context) {
    throw new Error("useProgress must be used within a ProgressProvider");
  }
  return context;
};

export const ProgressProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [state, dispatch] = useReducer(progressReducer, initialState);
  return (
    <ProgressContext.Provider value={{ state, dispatch }}>
      {children}
    </ProgressContext.Provider>
  );
};
