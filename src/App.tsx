/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { initStore } from './lib/store';
import { MqttProvider } from './lib/mqtt';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import ControlCenter from './pages/ControlCenter';
import AiLab from './pages/AiLab';
import DeviceManagement from './pages/DeviceManagement';
import HardwareConfigPage from './pages/HardwareConfig';
import Greenhouses from './pages/Greenhouses';
import GreenhouseSetupWizard from './pages/GreenhouseSetupWizard';
import GreenhouseDetails from './pages/GreenhouseDetails';
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
        <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The app hit an unexpected error. Reloading usually fixes it.
            </p>
            <p className="mt-4 break-words rounded-lg bg-muted p-3 font-mono text-xs text-muted-foreground">
              {this.state.error?.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 h-11 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Reload the app
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
      <div className="flex min-h-screen items-center justify-center gap-2.5 bg-background text-muted-foreground">
        <Loader2 size={20} className="animate-spin" aria-hidden="true" />
        <span className="text-sm">Loading…</span>
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
                <Route path="ai-lab" element={<AiLab />} />
                <Route path="devices" element={<DeviceManagement />} />
                <Route path="hardware" element={<HardwareConfigPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </MqttProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
