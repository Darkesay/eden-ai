import React, { useEffect, useState } from 'react';
import { Link, Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useMqtt } from '../lib/mqtt';
import { AUTH_GATE_ENABLED, useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import {
  ArrowLeft,
  Leaf,
  Home,
  Sprout,
  MessageSquare,
  Camera,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Sun,
  Moon
} from 'lucide-react';
import { cn } from '../lib/utils';
import { OnboardingTour } from './OnboardingTour';
import { DataSourceBadge } from './DataSourceBadge';
import { Button } from './ui/button';

interface PrimaryNavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  end?: boolean;
}

const NAV_ITEMS: PrimaryNavItem[] = [
  { to: '/', label: 'Home', shortLabel: 'Home', icon: Home, end: true },
  { to: '/greenhouses', label: 'My Greenhouse', shortLabel: 'Greenhouse', icon: Sprout },
  { to: '/assistant', label: 'AI Assistant', shortLabel: 'Assistant', icon: MessageSquare },
  { to: '/vision', label: 'Plant Vision', shortLabel: 'Vision', icon: Camera },
  { to: '/settings', label: 'Settings', shortLabel: 'Settings', icon: Settings }
];

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
  const [navCollapsed, setNavCollapsed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(SIDEBAR_KEY) === '1'
  );
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useMqtt();
  const { user, logout, activeGreenhouse, greenhouses, setActiveGreenhouseId } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [forceTour, setForceTour] = useState(false);

  // Back navigation: the header back button returns to the page visited before
  // the current one. It mirrors the browser's history entry index, so it arms
  // only when an earlier page exists — and disarms again at the first page.
  const [canGoBack, setCanGoBack] = useState(
    () => Number((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  );

  useEffect(() => {
    const idx = Number((window.history.state as { idx?: number } | null)?.idx ?? 0);
    setCanGoBack(idx > 0);
  }, [location.pathname, location.search]);

  // Listen for custom events to trigger the tour from anywhere
  useEffect(() => {
    const handleReplay = () => setForceTour(true);
    window.addEventListener('replay-tour', handleReplay);
    window.addEventListener('edens-open-tour', handleReplay);
    return () => {
      window.removeEventListener('replay-tour', handleReplay);
      window.removeEventListener('edens-open-tour', handleReplay);
    };
  }, []);

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

  const handleBack = () => {
    if (!canGoBack) return;
    navigate(-1);
  };

  const statusLabel = MQTT_LABEL[status] ?? status;
  const statusDotClass =
    status === 'connected'
      ? 'bg-success'
      : status === 'connecting' || status === 'demo'
        ? 'bg-warning'
        : 'bg-destructive';

  const initials = user
    ? (user.displayName
        .split(' ')
        .filter(Boolean)
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || user.email[0]?.toUpperCase() || '?')
    : '';

  const isOnAssistant = location.pathname.startsWith('/assistant') || location.pathname.startsWith('/ai-lab');

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
            title={navCollapsed ? 'EDENS AI — Home' : undefined}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Leaf size={17} aria-hidden="true" />
            </span>
            {!navCollapsed && (
              <span className="text-[15px] font-semibold tracking-tight">EDENS AI</span>
            )}
          </Link>
        </div>

        {/* Active greenhouse context — expanded only */}
        {!navCollapsed && (
          <div className="shrink-0 border-b border-border px-3 py-3">
            {greenhouses.length > 1 ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="sidebar-gh-select"
                  className="block px-1 text-[11px] font-medium text-muted-foreground"
                >
                  Active greenhouse
                </label>
                <select
                  id="sidebar-gh-select"
                  value={activeGreenhouse?.id || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    setActiveGreenhouseId(id);
                    if (location.pathname.startsWith('/greenhouses/') && !location.pathname.endsWith('/setup')) {
                      navigate(`/greenhouses/${id}`);
                    }
                  }}
                  className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs font-medium text-foreground focus:border-ring focus:outline-none focus:ring-3 focus:ring-ring/50"
                >
                  {greenhouses.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.cropType})
                    </option>
                  ))}
                </select>
              </div>
            ) : activeGreenhouse ? (
              <Link
                to={`/greenhouses/${activeGreenhouse.id}`}
                className="block rounded-lg border border-border bg-muted/40 px-3 py-2 transition-colors hover:bg-muted/70"
              >
                <div className="text-[11px] text-muted-foreground">Active greenhouse</div>
                <div className="mt-0.5 truncate text-sm font-medium text-foreground">
                  {activeGreenhouse.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {activeGreenhouse.cropType} · {activeGreenhouse.locationLabel}
                </div>
              </Link>
            ) : (
              <Link
                to="/greenhouses/setup"
                className="block rounded-lg border border-dashed border-primary/40 bg-accent/60 px-3 py-2 transition-colors hover:bg-accent"
              >
                <div className="text-xs font-medium text-accent-foreground">Set up your greenhouse</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Connect sensors &amp; camera in a few steps
                </div>
              </Link>
            )}
          </div>
        )}

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

        {/* Footer — data source, account, and sign out pinned to the bottom */}
        <div className="shrink-0 border-t border-border p-2">
          {!navCollapsed && (
            <div className="mb-1 px-1">
              <DataSourceBadge variant="badge" />
            </div>
          )}

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
                    {AUTH_GATE_ENABLED ? user.email : 'Open Testing Mode'}
                  </span>
                </span>
              )}
            </div>
          )}

          {/* Sign out — the last action in the rail (hidden in open testing mode) */}
          {AUTH_GATE_ENABLED && (
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
          )}
        </div>

        {/* Collapse handle — icon centered on the sidebar's right border */}
        <button
          type="button"
          onClick={toggleNav}
          aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!navCollapsed}
          className="absolute right-0 top-1/2 z-10 flex size-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {navCollapsed ? (
            <ChevronsRight size={14} aria-hidden="true" />
          ) : (
            <ChevronsLeft size={14} aria-hidden="true" />
          )}
        </button>
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
          <div className="flex h-14 items-center gap-3 px-4 md:px-6">
            {/* Back button — returns to the page visited before this one; never shown on the home dashboard */}
            {location.pathname !== '/' && (
              <button
                type="button"
                onClick={handleBack}
                disabled={!canGoBack}
                title="Back to previous page"
                aria-label="Back to previous page"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <ArrowLeft size={17} />
              </button>
            )}

            {/* Brand — mobile only (desktop brand lives in the sidebar) */}
            <Link to="/" className="flex shrink-0 items-center gap-2.5 md:hidden">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Leaf size={17} aria-hidden="true" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">EDENS AI</span>
            </Link>

            <div className="ml-auto flex items-center gap-2">
              {/* Data source context — compact on mobile (sidebar covers desktop) */}
              <span className="lg:hidden">
                <DataSourceBadge variant="pill" showFreshness={false} compact />
              </span>

              {/* Data source context — desktop only */}
              <span className="hidden lg:block">
                <DataSourceBadge variant="badge" />
              </span>

              {/* Broker status */}
              <span
                className="hidden h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground sm:flex"
                title={`Message broker status: ${statusLabel}`}
              >
                <StatusDot className={statusDotClass} />
                {statusLabel}
              </span>

              {/* Theme toggle */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={resolvedTheme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance'}
                title={resolvedTheme === 'dark' ? 'Light appearance' : 'Dark appearance'}
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {resolvedTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </button>

              {/* Primary assistant action */}
              {!isOnAssistant && (
                <Button
                  type="button"
                  onClick={() => navigate('/assistant')}
                  className="hidden h-9 px-3 sm:inline-flex"
                >
                  <MessageSquare size={15} aria-hidden="true" />
                  Ask EDENS AI
                </Button>
              )}

              {/* Sign out — mobile only (desktop sign-out lives in the sidebar) */}
              {AUTH_GATE_ENABLED && (
                <button
                  type="button"
                  onClick={handleLogout}
                  aria-label="Sign out"
                  title="Sign out"
                  className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
                >
                  <LogOut size={17} />
                </button>
              )}
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
                  <span>{item.shortLabel}</span>
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
