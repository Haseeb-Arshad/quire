import { createContext, useContext, useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { loadPrefs, updateGlobalPrefs, type AppTheme } from "../lib/preferences";

interface ThemeContextValue {
  appTheme: AppTheme;
  toggleAppTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  appTheme: "light",
  toggleAppTheme: () => {}
});

export function useAppTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function AppShell() {
  const [appTheme, setAppTheme] = useState<AppTheme>(() => loadPrefs().global.appTheme);

  useEffect(() => {
    document.documentElement.dataset.appTheme = appTheme;
    updateGlobalPrefs({ appTheme });
  }, [appTheme]);

  return (
    <ThemeContext.Provider
      value={{
        appTheme,
        toggleAppTheme: () => setAppTheme((current) => (current === "light" ? "dark" : "light"))
      }}
    >
      <div className="app-shell">
        <Outlet />
      </div>
    </ThemeContext.Provider>
  );
}
