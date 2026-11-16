// Renders a React hook in a real root. The test file needs a DOM, so it opens
// with Vitest's environment comment naming happy-dom.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

// Tells React this is a test, so updates made outside act() are reported.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Mount `useHook`. `result.current` always holds what its latest render returned. */
export function renderHook<T>(useHook: () => T): {
  result: { current: T };
  unmount: () => void;
} {
  const result = {} as { current: T };
  function Probe(): null {
    result.current = useHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return { result, unmount: () => act(() => root.unmount()) };
}
