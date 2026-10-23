import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router";
import { Toaster } from "sonner";
import { AppProvider } from "./app/appContext";
import { AppRoutes } from "./app/router";
import { TooltipProvider } from "./components/ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 0, refetchOnWindowFocus: false } },
});

export function App() {
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
