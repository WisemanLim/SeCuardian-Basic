import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router";
import { useEffect } from "react";
import LoginPage from "./pages/LoginPage";
import ChatPage from "./pages/ChatPage";
import SetupWizard from "./pages/setup/SetupWizard";
import AgentsPage from "./pages/agents/AgentsPage";
import UsersPage from "./pages/users/UsersPage";
import SettingsPage from "./pages/settings/SettingsPage";
import ProfilePage from "./pages/profile/ProfilePage";
import AddonAgentPage from "./pages/addon/AddonAgentPage";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";
import { getSetupStatus } from "./api/setup";

function SetupGuardOutlet() {
  const navigate = useNavigate();
  useEffect(() => {
    getSetupStatus()
      .then((status) => {
        if (!status.has_supervisor) navigate("/setup", { replace: true });
      })
      .catch(() => {});
  }, []);
  return <Outlet />;
}

function LayoutRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupWizard />} />

      <Route element={<SetupGuardOutlet />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/chat" element={<LayoutRoute><ChatPage /></LayoutRoute>} />
        <Route path="/agents" element={<LayoutRoute><AgentsPage /></LayoutRoute>} />
        <Route path="/users" element={<LayoutRoute><UsersPage /></LayoutRoute>} />
        <Route path="/settings" element={<LayoutRoute><SettingsPage /></LayoutRoute>} />
        <Route path="/profile" element={<LayoutRoute><ProfilePage /></LayoutRoute>} />
        <Route path="/addon/:agentKey" element={<LayoutRoute><AddonAgentPage /></LayoutRoute>} />
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Route>
    </Routes>
  );
}
