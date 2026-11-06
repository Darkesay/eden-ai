/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { Skeleton } from './components/ui/skeleton';
import { initStore } from './lib/store';
import { MqttProvider } from './lib/mqtt';
import { AUTH_GATE_ENABLED, AuthProvider, useAuth } from './lib/auth';
import { ThemeProvider } from './lib/theme';
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
        <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
            <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive">
              <AlertTriangle size={22} aria-hidden="true" />
            </div>
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The app hit an unexpected error. Reloading usually fixes it.
            </p>
            <p className="mt-4 break-words rounded-lg bg-muted p-3 font-mono text-xs text-muted-foreground">
              {this.state.error?.message || 'Unexpected display error.'}
            </p>
            <button
              type="button"
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

  if (!AUTH_GATE_ENABLED) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background p-6 text-muted-foreground"
        role="status"
        aria-live="polite"
        aria-label="Loading your greenhouse workspace"
      >
        <Skeleton className="size-11 rounded-xl" />
        <div className="w-full max-w-44 space-y-2">
          <Skeleton className="mx-auto h-4 w-44" />
          <Skeleton className="mx-auto h-3 w-32" />
        </div>
        <Skeleton className="h-3 w-56" />
        <span className="text-sm">Loading your greenhouse workspace…</span>
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
    <ThemeProvider>
      <ErrorBoundary>
        <AuthProvider>
          <MotionConfig reducedMotion="user">
            <BrowserRouter>
            <Routes>
              <Route
                path="/login"
                element={AUTH_GATE_ENABLED ? <Login /> : <Navigate to="/" replace />}
              />
              <Route
                path="/register"
                element={<Navigate to={AUTH_GATE_ENABLED ? '/login' : '/'} replace />}
              />
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <MqttProvider>
                      <AgentManager />
                      <Layout />
                    </MqttProvider>
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
          </MotionConfig>
        </AuthProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
