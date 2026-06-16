import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { useAuthStore } from './stores/auth-store';
import { Dashboard } from './pages/Dashboard';
import { ActivityFeed } from './pages/ActivityFeed';
import { KanbanBoard } from './pages/KanbanBoard';
import { AgentProfile } from './pages/AgentProfile';
import { Communications } from './pages/Communications';
import { Timeline } from './pages/Timeline';
import { Topology } from './pages/Topology';
import { AgentControls } from './pages/AgentControls';
import { Metrics } from './pages/Metrics';
import { Alerts } from './pages/Alerts';
import { SearchAudit } from './pages/SearchAudit';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { CheckEmail } from './pages/CheckEmail';
import { VerifyEmail } from './pages/VerifyEmail';
import { AgentCreate } from './pages/AgentCreate';
import { Settings } from './pages/Settings';
import { Gateways } from './pages/Gateways';
import { Chat } from './pages/Chat';
import { MotherChat } from './pages/MotherChat';
import { LiveBlackboardTracePage } from './pages/LiveBlackboardTrace';
import { Boards } from './pages/Boards';
import { BoardDetail } from './pages/BoardDetail';
import { Approvals } from './pages/Approvals';
import { SkillsMarketplace } from './pages/SkillsMarketplace';
import { SoulTemplates } from './pages/SoulTemplates';
import { CustomFields } from './pages/CustomFields';
import { Invitations } from './pages/Invitations';
import { LandingPage } from './pages/landing/LandingPage';
import { DocsLayout } from './pages/docs/DocsLayout';
import { DocsGettingStarted } from './pages/docs/DocsGettingStarted';
import { DocsMcpIntegration } from './pages/docs/DocsMcpIntegration';
import { DocsRemoteAgents } from './pages/docs/DocsRemoteAgents';
import { DocsAgentManagement } from './pages/docs/DocsAgentManagement';
import { DocsAlerts } from './pages/docs/DocsAlerts';
import { DocsApiReference } from './pages/docs/DocsApiReference';
import { DocsOrganizations } from './pages/docs/DocsOrganizations';
import { DocsWebSocketEvents } from './pages/docs/DocsWebSocketEvents';
import { AUTH_DISABLED } from './lib/auth-mode';

function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-nexus-500 to-nexus-700 flex items-center justify-center text-white font-bold text-2xl animate-glow">
            N
          </div>
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (AUTH_DISABLED || isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <LandingPage />;
}

export function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={AUTH_DISABLED ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/signup" element={AUTH_DISABLED ? <Navigate to="/dashboard" replace /> : <Signup />} />
      <Route path="/check-email" element={AUTH_DISABLED ? <Navigate to="/dashboard" replace /> : <CheckEmail />} />
      <Route path="/verify-email" element={AUTH_DISABLED ? <Navigate to="/dashboard" replace /> : <VerifyEmail />} />

      {/* Documentation (public) */}
      <Route path="/docs" element={<DocsLayout />}>
        <Route index element={<DocsGettingStarted />} />
        <Route path="mcp-integration" element={<DocsMcpIntegration />} />
        <Route path="remote-agents" element={<DocsRemoteAgents />} />
        <Route path="agent-management" element={<DocsAgentManagement />} />
        <Route path="alerts" element={<DocsAlerts />} />
        <Route path="api-reference" element={<DocsApiReference />} />
        <Route path="organizations" element={<DocsOrganizations />} />
        <Route path="websocket-events" element={<DocsWebSocketEvents />} />
      </Route>

      {/* Protected routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/activity" element={<ActivityFeed />} />
          <Route path="/comms" element={<Communications />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/tasks" element={<KanbanBoard />} />
          <Route path="/topology" element={<Topology />} />
          <Route path="/controls" element={<AgentControls />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/search" element={<SearchAudit />} />
          <Route path="/agents/new" element={<AgentCreate />} />
          <Route path="/agents/:id/edit" element={<AgentCreate />} />
          <Route path="/agents/:id" element={<AgentProfile />} />
          <Route path="/gateways" element={<Gateways />} />
          <Route path="/boards" element={<Boards />} />
          <Route path="/boards/:id" element={<BoardDetail />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/mother-chat" element={<MotherChat />} />
          <Route path="/production/:boardId" element={<MotherChat />} />
          <Route path="/production/:boardId/trace" element={<LiveBlackboardTracePage />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/skills" element={<SkillsMarketplace />} />
          <Route path="/soul-templates" element={<SoulTemplates />} />
          <Route path="/custom-fields" element={<CustomFields />} />
          <Route path="/invitations" element={<Invitations />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
    </Routes>
  );
}
