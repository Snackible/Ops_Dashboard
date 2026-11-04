import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./lib/auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { registerAllSubscribers } from "./lib/integrations/registerSubscribers";
import { startSheetsPolling } from "./lib/data/sheetsPolling";
import { isSheetsConfigured, callSheets } from "./lib/data/sheetsClient";
import { liveStore } from "./lib/data/liveStore";
import "./styles/tokens.css";

registerAllSubscribers();
// Seeds accounts/inventory/requests/product requests once, up front, so no
// individual page needs to fetch its own copy on mount - see liveStore.ts.
liveStore.refreshAll();
if (isSheetsConfigured) {
  startSheetsPolling();
  // Asks the server to hash any plain-text PINs typed into the Users sheet
  // (see server/lib/pinVault.js). Once per browser session is plenty; the
  // result is just a count and a failure is harmless - login retries it too.
  try {
    if (!sessionStorage.getItem("snackible-logins-secured")) {
      sessionStorage.setItem("snackible-logins-secured", "1");
      callSheets("secureLogins").catch(() => {});
    }
  } catch {
    /* sessionStorage unavailable - skip, login still secures PINs */
  }
}

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
