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
import { TierBoardPage } from "./pages/ops/TierBoardPage";
import { HistoryPage } from "./pages/ops/HistoryPage";

const B2B_NAV = [
  { to: "/b2b", label: "Catalog" },
  { to: "/b2b/requests", label: "My Requests" },
];

const OPS_NAV = [
  { to: "/ops", label: "Queue" },
  { to: "/ops/tiers", label: "Tiers" },
  { to: "/ops/inventory", label: "Inventory" },
  { to: "/ops/history", label: "History" },
];

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
              <PortalShell brandLabel="B2B" navItems={B2B_NAV}>
                <CatalogPage />
              </PortalShell>
            </RequireRole>
          }
        />
        <Route
          path="/b2b/requests"
          element={
            <RequireRole role="b2b">
              <PortalShell brandLabel="B2B" navItems={B2B_NAV}>
                <MyRequestsPage />
              </PortalShell>
            </RequireRole>
          }
        />

        <Route
          path="/ops"
          element={
            <RequireRole role="ops">
              <PortalShell brandLabel="Ops" navItems={OPS_NAV}>
                <QueuePage />
              </PortalShell>
            </RequireRole>
          }
        />
        <Route
          path="/ops/tiers"
          element={
            <RequireRole role="ops">
              <PortalShell brandLabel="Ops" navItems={OPS_NAV}>
                <TierBoardPage />
              </PortalShell>
            </RequireRole>
          }
        />
        <Route
          path="/ops/inventory"
          element={
            <RequireRole role="ops">
              <PortalShell brandLabel="Ops" navItems={OPS_NAV}>
                <InventoryPage />
              </PortalShell>
            </RequireRole>
          }
        />
        <Route
          path="/ops/history"
          element={
            <RequireRole role="ops">
              <PortalShell brandLabel="Ops" navItems={OPS_NAV}>
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
