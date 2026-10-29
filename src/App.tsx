/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { initStore } from './lib/store';
import { MqttProvider } from './lib/mqtt';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import ControlCenter from './pages/ControlCenter';
import Greenhouses from './pages/Greenhouses';
import GreenhouseSetupWizard from './pages/GreenhouseSetupWizard';
import GreenhouseDetails from './pages/GreenhouseDetails';
import AiAssistant from './pages/AiAssistant';
import PlantVision from './pages/PlantVision';
import SettingsPage from './pages/Settings';
import { AgentManager } from './agents/AgentManager';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background text-foreground p-4">
          <div className="w-full max-w-md rounded-2xl bg-card p-8 border border-border text-center shadow-xs space-y-4">
            <div className="w-11 h-11 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-center justify-center mx-auto">
              <AlertTriangle size={22} />
            </div>
            <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
            <p className="text-xs text-muted-foreground font-mono">
              {this.state.error?.message || 'Unexpected display error.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-10 px-6 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary/90 cursor-pointer"
            >
              Reload EDENS AI
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2.5 bg-background text-foreground">
        <Loader2 size={26} className="animate-spin text-primary" />
        <span className="text-xs font-medium text-muted-foreground">Loading your greenhouse workspace...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    initStore().then(() => setInitialized(true));
  }, []);

  if (!initialized) return null;

  return (
    <ErrorBoundary>
      <AuthProvider>
        <MqttProvider>
          <AgentManager />
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <Layout />
                  </RequireAuth>
                }
              >
                <Route index element={<ControlCenter />} />
                <Route path="greenhouses" element={<Greenhouses />} />
                <Route path="greenhouses/setup" element={<GreenhouseSetupWizard />} />
                <Route path="greenhouses/:greenhouseId" element={<GreenhouseDetails />} />
                <Route path="greenhouses/:greenhouseId/setup" element={<GreenhouseSetupWizard />} />
                <Route path="assistant" element={<AiAssistant />} />
                <Route path="ai-lab" element={<Navigate to="/assistant" replace />} />
                <Route path="vision" element={<PlantVision />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="hardware" element={<Navigate to="/settings?tab=hardware" replace />} />
                <Route path="devices" element={<Navigate to="/settings?tab=diagnostics" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </MqttProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
