import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth/AuthContext";
import { RequireRole } from "./components/RequireRole";
import { PortalShell } from "./components/PortalShell";
import { ToastHost } from "./components/ToastHost";
import { LoginPage } from "./pages/LoginPage";
import { CatalogPage } from "./pages/b2b/CatalogPage";
import { MyRequestsPage } from "./pages/b2b/MyRequestsPage";
import { QueuePage } from "./pages/ops/QueuePage";
import { InventoryPage } from "./pages/ops/InventoryPage";
import { HistoryPage } from "./pages/ops/HistoryPage";

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "ops" ? "/ops" : "/b2b"} replace />;
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/b2b"
          element={
            <RequireRole role="b2b">
              <PortalShell
                brandLabel="B2B"
                navItems={[
                  { to: "/b2b", label: "Catalog" },
                  { to: "/b2b/requests", label: "My Requests" },
                ]}
              >
                <CatalogPage />
              </PortalShell>
            </RequireRole>
          }
        />
        <Route
          path="/b2b/requests"
          element={
            <RequireRole role="b2b">
              <PortalShell
                brandLabel="B2B"
                navItems={[
                  { to: "/b2b", label: "Catalog" },
                  { to: "/b2b/requests", label: "My Requests" },
                ]}
              >
                <MyRequestsPage />
              </PortalShell>
            </RequireRole>
          }
        />

        <Route
          path="/ops"
          element={
            <RequireRole role="ops">
              <PortalShell
                brandLabel="Ops"
                navItems={[
                  { to: "/ops", label: "Queue" },
                  { to: "/ops/inventory", label: "Inventory" },
                  { to: "/ops/history", label: "History" },
                ]}
              >
                <QueuePage />
              </PortalShell>
            </RequireRole>
          }
        />
        <Route
          path="/ops/inventory"
          element={
            <RequireRole role="ops">
              <PortalShell
                brandLabel="Ops"
                navItems={[
                  { to: "/ops", label: "Queue" },
                  { to: "/ops/inventory", label: "Inventory" },
                  { to: "/ops/history", label: "History" },
                ]}
              >
                <InventoryPage />
              </PortalShell>
            </RequireRole>
          }
        />
        <Route
          path="/ops/history"
          element={
            <RequireRole role="ops">
              <PortalShell
                brandLabel="Ops"
                navItems={[
                  { to: "/ops", label: "Queue" },
                  { to: "/ops/inventory", label: "Inventory" },
                  { to: "/ops/history", label: "History" },
                ]}
              >
                <HistoryPage />
              </PortalShell>
            </RequireRole>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </>
  );
}
