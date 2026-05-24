"use client";
import { createContext, useContext, useEffect, useState } from "react";

interface TestModeContextType {
  testMode: boolean;
  setTestMode: (v: boolean) => void;
}

const TestModeContext = createContext<TestModeContextType>({
  testMode: false,
  setTestMode: () => {},
});

export function TestModeProvider({ children }: { children: React.ReactNode }) {
  const [testMode, setTestModeState] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("testMode") === "true") setTestModeState(true);
  }, []);

  const setTestMode = (v: boolean) => {
    setTestModeState(v);
    localStorage.setItem("testMode", String(v));
  };

  return (
    <TestModeContext.Provider value={{ testMode, setTestMode }}>
      {children}
    </TestModeContext.Provider>
  );
}

export const useTestMode = () => useContext(TestModeContext);
