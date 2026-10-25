import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { HashRouter } from "react-router";
import { Toaster } from "sonner";
import { AppProvider } from "./app/appContext";
import { AppRoutes } from "./app/router";
import { useAppStore } from "./app/appStore";
import { isTableWindow } from "./app/platform";
import { TableView } from "./features/table/TableView";
import { TooltipProvider } from "./components/ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 0, refetchOnWindowFocus: false } },
});

/** Applies the chosen palette (Settings: Theme) to the document root. */
function useThemeAttribute() {
  const theme = useAppStore((s) => s.settings.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}

export function App() {
  useThemeAttribute();
  if (isTableWindow()) {
    return (
      <QueryClientProvider client={queryClient}>
        <AppProvider minimal>
          <TableView />
        </AppProvider>
      </QueryClientProvider>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <HashRouter>
          <AppProvider>
            <AppRoutes />
          </AppProvider>
        </HashRouter>
      </TooltipProvider>
      <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: "var(--color-bg-elevated)", color: "var(--color-ink)", border: "1px solid var(--color-border-strong)", fontSize: 13 } }} />
    </QueryClientProvider>
  );
}
