import React, { useEffect, useState } from 'react';
import { Link, Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useMqtt } from '../lib/mqtt';
import { useAuth } from '../lib/auth';
import {
  Sun,
  Moon,
  LogOut,
  LayoutDashboard,
  Brain,
  Cpu,
  Sliders,
  Sprout,
  Leaf,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { cn } from '../lib/utils';
import { OnboardingTour } from './OnboardingTour';
import { DataSourceBadge } from './DataSourceBadge';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/greenhouses', label: 'Greenhouses', icon: Sprout, end: false },
  { to: '/ai-lab', label: 'AI Lab', icon: Brain, end: false },
  { to: '/devices', label: 'Devices', icon: Cpu, end: false },
  { to: '/hardware', label: 'Hardware', icon: Sliders, end: false }
] as const;

const MQTT_LABEL: Record<string, string> = {
  connected: 'Online',
  connecting: 'Connecting',
  demo: 'Demo',
  disconnected: 'Offline'
};

const SIDEBAR_KEY = 'botanix_nav_collapsed';

function StatusDot({ className }: { className?: string }) {
  return <span className={cn('size-1.5 rounded-full', className)} aria-hidden="true" />;
}

export default function Layout() {
  const [isDark, setIsDark] = useState(true);
  const [navCollapsed, setNavCollapsed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(SIDEBAR_KEY) === '1'
  );
  const navigate = useNavigate();
  const { status } = useMqtt();
  const { user, logout } = useAuth();
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
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('botanix_theme', next ? 'dark' : 'light');
  };

  const toggleNav = () => {
    setNavCollapsed((c) => {
      const next = !c;
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      return next;
    });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const statusLabel = MQTT_LABEL[status] ?? status;
  const statusDotClass =
    status === 'connected'
      ? 'bg-success'
      : status === 'connecting'
        ? 'bg-warning'
        : status === 'demo'
          ? 'bg-warning'
          : 'bg-destructive';

  // Avatar initials for the signed-in account shown in the sidebar footer
  const initials = user
    ? (user.displayName
        .split(' ')
        .filter(Boolean)
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || user.email[0]?.toUpperCase() || '?')
    : '';

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ---------------------------------------------------------------- */}
      {/* Desktop side navigation — collapsible rail                       */}
      {/* ---------------------------------------------------------------- */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden border-r border-border bg-card md:flex md:flex-col md:transition-[width] md:duration-200 md:ease-out',
          navCollapsed ? 'md:w-[68px]' : 'md:w-60'
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            'flex h-14 shrink-0 items-center border-b border-border px-4',
            navCollapsed && 'justify-center px-0'
          )}
        >
          <Link
            to="/"
            className="flex items-center gap-2.5"
            title={navCollapsed ? 'EDENS AI — Dashboard' : undefined}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Leaf size={17} aria-hidden="true" />
            </span>
            {!navCollapsed && (
              <span className="text-[15px] font-semibold tracking-tight">EDENS AI</span>
            )}
          </Link>
        </div>

        {/* Destinations */}
        <nav aria-label="Main" className="custom-scrollbar flex-1 overflow-y-auto p-2">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  title={navCollapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                      navCollapsed && 'justify-center px-0',
                      isActive
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )
                  }
                >
                  <item.icon size={18} className="shrink-0" aria-hidden="true" />
                  <span className={cn('truncate', navCollapsed && 'sr-only')}>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Footer — account context, collapse control, and sign out pinned to the rail bottom */}
        <div className="shrink-0 border-t border-border p-2">
          {/* Signed-in account — context for the sign-out action */}
          {user && (
            <div
              className={cn(
                'mb-1 flex items-center gap-2.5 rounded-lg px-2 py-1.5',
                navCollapsed && 'justify-center px-0'
              )}
              title={navCollapsed ? `${user.displayName} — ${user.email}` : undefined}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                {initials}
              </span>
              {!navCollapsed && (
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {user.displayName}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {user.email}
                  </span>
                </span>
              )}
            </div>
          )}

          {/* Collapse control */}
          <button
            type="button"
            onClick={toggleNav}
            aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!navCollapsed}
            className={cn(
              'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              navCollapsed && 'justify-center px-0'
            )}
          >
            {navCollapsed ? (
              <PanelLeftOpen size={17} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={17} aria-hidden="true" />
            )}
            <span className={cn('font-medium', navCollapsed && 'sr-only')}>
              {navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </span>
          </button>

          {/* Sign out — the last action in the rail */}
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sign out"
            title={navCollapsed ? 'Sign out' : undefined}
            className={cn(
              'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive',
              navCollapsed && 'justify-center px-0'
            )}
          >
            <LogOut size={17} aria-hidden="true" />
            <span className={cn('font-medium', navCollapsed && 'sr-only')}>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Content column                                                    */}
      {/* ---------------------------------------------------------------- */}
      <div
        className={cn(
          'md:transition-[padding-left] md:duration-200 md:ease-out',
          navCollapsed ? 'md:pl-[68px]' : 'md:pl-60'
        )}
      >
        <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-lg">
          <div className="flex h-14 items-center gap-4 px-4 md:px-6">
            {/* Brand — mobile only (desktop brand lives in the sidebar) */}
            <Link to="/" className="flex shrink-0 items-center gap-2.5 md:hidden">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Leaf size={17} aria-hidden="true" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">EDENS AI</span>
            </Link>

            {/* Data source context — desktop only, balances the bar */}
            <span className="hidden md:block">
              <DataSourceBadge variant="badge" />
            </span>

            <div className="ml-auto flex items-center gap-2">
              <span
                className="hidden h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground sm:flex"
                title={`Message broker status: ${statusLabel}`}
              >
                <StatusDot className={statusDotClass} />
                {statusLabel}
              </span>

              {user && (
                <span className="hidden max-w-[150px] truncate text-xs text-muted-foreground xl:inline">
                  {user.displayName}
                </span>
              )}

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={isDark ? 'Switch to light appearance' : 'Switch to dark appearance'}
                title={isDark ? 'Light appearance' : 'Dark appearance'}
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {isDark ? <Sun size={17} /> : <Moon size={17} />}
              </button>

              <button
                type="button"
                onClick={handleLogout}
                aria-label="Sign out"
                title="Sign out"
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </header>

        {status === 'demo' && (
          <div className="border-b border-warning/25 bg-warning/10 px-4 py-1.5 text-center text-xs font-medium text-warning">
            Running in demo mode — no live broker connected
          </div>
        )}

        <main className="mx-auto max-w-7xl px-4 py-8 pb-28 md:px-6 md:pb-10 lg:px-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation — five destinations, always visible */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
      >
        <div className="grid h-16 grid-cols-5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  isActive ? 'text-brand' : 'text-muted-foreground'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <OnboardingTour forceShow={forceTour} onClose={() => setForceTour(false)} />
    </div>
  );
}
