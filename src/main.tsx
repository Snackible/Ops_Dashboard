import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./lib/auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { registerAllSubscribers } from "./lib/integrations/registerSubscribers";
import { startRealtimeSync } from "./lib/data/supabaseDataClient";
import { isSupabaseConfigured } from "./lib/data/supabaseClient";
import "./styles/tokens.css";

registerAllSubscribers();
if (isSupabaseConfigured) startRealtimeSync();

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
