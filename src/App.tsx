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
        <div className="flex min-h-screen items-center justify-center bg-[#040404] text-[#F0F0F0]">
          <div className="w-full max-w-md rounded-2xl bg-[#080808] p-8 border border-[#1A2A1A] text-center shadow-xl">
            <h1 className="text-2xl font-bold text-red-500 mb-4">EDENS AI CRASHED</h1>
            <p className="mb-6 opacity-70 font-mono text-sm">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-[#10B981] text-black font-semibold rounded-lg hover:opacity-90"
            >
              Reload System
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
      <div className="min-h-screen flex items-center justify-center bg-[#040404] text-[#10B981]">
        <Loader2 size={28} className="animate-spin" />
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
