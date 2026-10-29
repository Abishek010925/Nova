import { createContext, useContext } from "react";

/** What the lesson page tells the sidebar, so course info and lesson progress live in one place. */
export type LessonPanel = {
  conceptIndex: number;
  started: boolean;
  done: boolean;
  pace: "slow" | "balanced" | "brisk";
  busy: boolean;
  onComplete: () => void;
};

export type LessonPanelContextValue = {
  panel: LessonPanel | null;
  setPanel: (panel: LessonPanel | null) => void;
};

export const LessonPanelContext = createContext<LessonPanelContextValue>({
  panel: null,
  setPanel: () => {},
});

export function useLessonPanel() {
  return useContext(LessonPanelContext);
}
