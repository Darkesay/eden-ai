/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { store, initStore } from './lib/store';
import { MqttProvider } from './lib/mqtt';
import Layout from './components/Layout';
import Login from './pages/Login';
import ControlCenter from './pages/ControlCenter';
import AiLab from './pages/AiLab';
import DeviceManagement from './pages/DeviceManagement';

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
  const isAuth = localStorage.getItem('botanix_auth') === 'true';
  const location = useLocation();

  if (!isAuth) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

import { AgentManager } from './agents/AgentManager';

export default function App() {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    initStore().then(() => setInitialized(true));
  }, []);

  if (!initialized) return null;

  return (
    <ErrorBoundary>
      <MqttProvider>
        <AgentManager />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<ControlCenter />} />
              <Route path="ai-lab" element={<AiLab />} />
              <Route path="devices" element={<DeviceManagement />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </MqttProvider>
    </ErrorBoundary>
  );
}

