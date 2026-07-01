import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter
} from "@tanstack/react-router";
import { AppShell } from "./app/AppShell";
import { LibraryPage } from "./app/LibraryPage";
import { ReaderPage } from "./app/ReaderPage";
import "./styles/index.css";

const rootRoute = createRootRoute({
  component: AppShell
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LibraryPage
});

const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "books/$bookId",
  component: ReaderPage
});

const routeTree = rootRoute.addChildren([indexRoute, bookRoute]);
const router = createRouter({ routeTree });

// Data lives in IndexedDB: "always" keeps queries running while offline, and
// nothing goes stale on its own — we invalidate explicitly after writes.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "always", staleTime: Infinity, retry: false },
    mutations: { networkMode: "always" }
  }
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
