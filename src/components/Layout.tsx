import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useMqtt } from '../lib/mqtt';
import { Sun, Moon, LogOut, Loader2, Menu, X, LayoutDashboard, Brain, Cpu, Sliders } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { OnboardingTour } from './OnboardingTour';
import { DataSourceBadge } from './DataSourceBadge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Layout() {
  const [isDark, setIsDark] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useMqtt();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [forceTour, setForceTour] = useState(false);

  // Listen for custom event to trigger tour from anywhere
  useEffect(() => {
    const handleReplay = () => setForceTour(true);
    window.addEventListener('replay-tour', handleReplay);
    return () => window.removeEventListener('replay-tour', handleReplay);
  }, []);

  useEffect(() => {
    // initialize theme
    const stored = localStorage.getItem('botanix_theme');
    if (stored === 'light') {
      setIsDark(false);
      document.documentElement.classList.remove('dark');
    } else {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    if (isDark) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('botanix_theme', 'light');
      setIsDark(false);
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('botanix_theme', 'dark');
      setIsDark(true);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('botanix_auth');
    navigate('/login');
  };

  const navLinks = [
    { to: '/', label: 'Control Center' },
    { to: '/ai-lab', label: 'AI Lab' },
    { to: '/devices', label: 'Device Management' },
    { to: '/hardware', label: 'Hardware Config' },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAF8] dark:bg-[#040404] text-[#1A1A1A] dark:text-[#F0F0F0] font-sans transition-colors duration-500 relative pb-20 md:pb-0">
      {/* Subtle radial gradient mesh */}
      <div className="fixed inset-0 pointer-events-none transition-opacity duration-500">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#10B981]/5 dark:bg-[#10B981]/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#34D399]/5 dark:bg-[#34D399]/5 blur-[100px]" />
      </div>

      <header className="sticky top-0 z-50 bg-[#FFFFFF]/80 dark:bg-[#040404]/80 backdrop-blur-xl border-b border-[#D1E8D1] dark:border-[#1A2A1A] transition-colors duration-500">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <div className="text-xl font-bold tracking-tight text-[#059669] dark:text-[#10B981]">EDENS AI ✨🌿</div>
            </div>
            <div className="text-[9px] uppercase font-mono font-bold tracking-[0.2em] text-[#10B981] opacity-80">Powered by RA</div>
          </div>

          <nav className="hidden md:flex gap-1 ml-10">
            {navLinks.map((link) => {
              const isAiLab = link.to === '/ai-lab';
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => cn(
                    "px-4 py-2 rounded-xl font-medium text-sm transition-all flex items-center gap-2",
                    isActive 
                      ? "bg-[#059669]/10 dark:bg-[#10B981]/10 text-[#059669] dark:text-[#10B981]" 
                      : "hover:bg-[#059669]/5 dark:hover:bg-[#10B981]/5 opacity-70 hover:opacity-100"
                  )}
                >
                  {isAiLab && (
                    <img 
                      src="https://i.imgur.com/WOeaqFK.png" 
                      alt="AI Lab Logo" 
                      className="w-6 h-6 rounded-lg shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  )}
                  {isAiLab && <Brain size={16} className="hidden text-[#10B981]" />}
                  {link.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <DataSourceBadge variant="badge" />

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FFFFFF] dark:bg-[#080808] border border-[#D1E8D1] dark:border-[#1A2A1A]">
              <div className={cn(
                "w-2 h-2 rounded-full",
                status === 'connected' ? 'bg-[#10B981] animate-pulse' :
                status === 'connecting' ? 'bg-amber-400 animate-pulse' :
                status === 'demo' ? 'bg-yellow-500' : 'bg-red-500'
              )} />
              <span className="text-xs font-mono uppercase tracking-wider opacity-80">
                MQTT: {status}
              </span>
            </div>

            <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/5 transition-all">
              <div className={cn("transition-transform duration-500", isDark ? "rotate-180" : "rotate-0")}>
                {isDark ? <Moon size={20} /> : <Sun size={20} />}
              </div>
            </button>
            <button onClick={handleLogout} className="p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 transition-colors">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#F8FAF8]/90 dark:bg-[#040404]/90 backdrop-blur-xl border-t border-[#D1E8D1] dark:border-[#1A2A1A] pb-safe transition-colors duration-500">
        <div className="flex items-center justify-around h-16 px-2">
          {navLinks.map((link) => {
            const isAiLab = link.to === '/ai-lab';
            return (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => cn(
                  "flex flex-col items-center justify-center w-full h-full gap-1 transition-colors",
                  isActive 
                    ? "text-[#059669] dark:text-[#10B981]" 
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {link.to === '/' ? <LayoutDashboard size={20} /> : 
                 link.to === '/hardware' ? <Sliders size={20} /> :
                 isAiLab ? (
                   <>
                     <img 
                       src="https://i.imgur.com/WOeaqFK.png" 
                       alt="AI Lab Logo" 
                       className="w-5 h-5 rounded shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                       onError={(e) => {
                         e.currentTarget.style.display = 'none';
                         e.currentTarget.nextElementSibling?.classList.remove('hidden');
                       }}
                     />
                     <Brain size={20} className="hidden text-[#10B981]" />
                   </>
                 ) : 
                 <Cpu size={20} />}
                <span className="text-[10px] font-medium tracking-wide">{link.label}</span>
              </NavLink>
            );
          })}
          <button onClick={toggleTheme} className="flex flex-col items-center justify-center w-full h-full gap-1 text-gray-500 transition-all">
            <div className={cn("transition-transform duration-500", isDark ? "rotate-180" : "rotate-0")}>
              {isDark ? <Moon size={20} /> : <Sun size={20} />}
            </div>
            <span className="text-[10px] font-medium tracking-wide">Theme</span>
          </button>
        </div>
      </div>

      {status === 'demo' && (
        <div className="relative z-10 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-4 py-2 text-center text-sm font-medium border-b border-yellow-500/30 backdrop-blur-md">
          MQTT Offline – Running in Demo Mode
        </div>
      )}

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-8">
        <Outlet />
      </main>
      
      <OnboardingTour forceShow={forceTour} onClose={() => setForceTour(false)} />
    </div>
  );
}
