import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./lib/auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { registerAllSubscribers } from "./lib/integrations/registerSubscribers";
import { startSheetsPolling } from "./lib/data/sheetsPolling";
import { isSheetsConfigured } from "./lib/data/sheetsClient";
import { liveStore } from "./lib/data/liveStore";
import "./styles/tokens.css";

registerAllSubscribers();
// Seeds accounts/inventory/requests/product requests once, up front, so no
// individual page needs to fetch its own copy on mount - see liveStore.ts.
liveStore.refreshAll();
if (isSheetsConfigured) startSheetsPolling();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
