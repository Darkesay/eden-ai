import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Camera,
  ChevronRight,
  Home,
  LogOut,
  MessageSquare,
  Moon,
  Settings,
  Sprout,
  Sun
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { OnboardingTour } from './OnboardingTour';
import { DataSourceBadge } from './DataSourceBadge';
import { Button } from './ui/button';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PrimaryNavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  matchPrefix?: string;
}

const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  { to: '/', label: 'Home', shortLabel: 'Home', icon: Home },
  {
    to: '/greenhouses',
    label: 'My Greenhouse',
    shortLabel: 'Greenhouse',
    icon: Sprout,
    matchPrefix: '/greenhouses'
  },
  {
    to: '/assistant',
    label: 'AI Assistant',
    shortLabel: 'Assistant',
    icon: MessageSquare,
    matchPrefix: '/assistant'
  },
  {
    to: '/vision',
    label: 'Plant Vision',
    shortLabel: 'Vision',
    icon: Camera,
    matchPrefix: '/vision'
  },
  {
    to: '/settings',
    label: 'Settings',
    shortLabel: 'Settings',
    icon: Settings,
    matchPrefix: '/settings'
  }
];

function getBreadcrumbLabel(pathname: string, activeGhName?: string): { section: string; detail?: string } {
  if (pathname === '/') {
    return { section: 'Home', detail: 'Overview' };
  }
  if (pathname.startsWith('/greenhouses/setup') || pathname.endsWith('/setup')) {
    return { section: 'My Greenhouse', detail: 'Guided Setup' };
  }
  if (pathname.startsWith('/greenhouses/')) {
    return { section: 'My Greenhouse', detail: activeGhName || 'Greenhouse Monitor' };
  }
  if (pathname.startsWith('/greenhouses')) {
    return { section: 'My Greenhouse' };
  }
  if (pathname.startsWith('/assistant') || pathname.startsWith('/ai-lab')) {
    return { section: 'AI Assistant', detail: 'Crop & Climate Advisor' };
  }
  if (pathname.startsWith('/vision')) {
    return { section: 'Plant Vision', detail: 'Leaf & Camera Inspection' };
  }
  if (pathname.startsWith('/settings') || pathname.startsWith('/hardware') || pathname.startsWith('/devices')) {
    return { section: 'Settings' };
  }
  return { section: 'Home' };
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, activeGreenhouse, greenhouses, setActiveGreenhouseId, logout } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [forceTour, setForceTour] = useState(false);

  useEffect(() => {
    const handleReplay = () => setForceTour(true);
    window.addEventListener('replay-tour', handleReplay);
    window.addEventListener('edens-open-tour', handleReplay);
    return () => {
      window.removeEventListener('replay-tour', handleReplay);
      window.removeEventListener('edens-open-tour', handleReplay);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const breadcrumb = getBreadcrumbLabel(location.pathname, activeGreenhouse?.name);
  const isOnAssistant = location.pathname.startsWith('/assistant') || location.pathname.startsWith('/ai-lab');

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 lg:w-68 shrink-0 flex-col border-r border-border bg-sidebar sticky top-0 h-screen">
        {/* Brand */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-sidebar-border">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Sprout size={20} />
            </div>
            <div>
              <div className="text-base font-bold tracking-tight text-foreground leading-none">
                EDENS AI
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Greenhouse Advisor
              </div>
            </div>
          </Link>
        </div>

        {/* Active Greenhouse Switcher */}
        <div className="px-4 pt-4 pb-2">
          {greenhouses.length > 1 ? (
            <div className="space-y-1">
              <label htmlFor="sidebar-gh-select" className="text-[11px] font-medium text-muted-foreground px-1">
                Active Greenhouse
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
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
              className="block rounded-xl border border-border bg-background px-3.5 py-2.5 hover:border-primary/40 transition-colors"
            >
              <div className="text-[11px] text-muted-foreground">Active Greenhouse</div>
              <div className="text-sm font-semibold text-foreground truncate mt-0.5">
                {activeGreenhouse.name}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {activeGreenhouse.cropType} · {activeGreenhouse.locationLabel}
              </div>
            </Link>
          ) : (
            <Link
              to="/greenhouses/setup"
              className="block rounded-xl border border-dashed border-primary/40 bg-accent/60 px-3.5 py-2.5 hover:bg-accent transition-colors"
            >
              <div className="text-xs font-semibold text-accent-foreground">Set Up Your Greenhouse</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Connect sensors &amp; camera in 6 simple steps
              </div>
            </Link>
          )}
        </div>

        {/* Primary 5-Item Navigation */}
        <nav aria-label="Main navigation" className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isItemActive =
              item.to === '/'
                ? location.pathname === '/'
                : Boolean(item.matchPrefix && location.pathname.startsWith(item.matchPrefix));

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={cn(
                  'h-10 px-3 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap shrink-0',
                  isItemActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon
                  size={18}
                  className={cn(isItemActive ? 'text-primary' : 'text-muted-foreground')}
                />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Sidebar Footer: Honest Data Source + Account */}
        <div className="p-4 border-t border-sidebar-border space-y-3">
          <DataSourceBadge className="w-full justify-center py-1.5" />

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground truncate">
                {user?.displayName || 'Farmer'}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {user?.email || ''}
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
              className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors shrink-0 cursor-pointer"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col pb-20 md:pb-0">
        {/* Top Bar (Compact <= 56px on mobile, 64px on desktop) */}
        <header className="sticky top-0 z-30 h-14 md:h-16 bg-card/95 backdrop-blur-sm border-b border-border px-4 md:px-8 flex items-center justify-between gap-3">
          {/* Left: Mobile Brand OR Desktop Breadcrumb */}
          <div className="flex items-center gap-2 min-w-0">
            <Link to="/" className="md:hidden flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Sprout size={17} />
              </div>
              <span className="font-bold text-sm tracking-tight text-foreground">EDENS AI</span>
            </Link>

            <div className="hidden md:flex items-center gap-2 text-sm min-w-0">
              <span className="font-medium text-muted-foreground">EDENS AI</span>
              <ChevronRight size={14} className="text-muted-foreground/60 shrink-0" />
              <span className={cn('truncate', breadcrumb.detail ? 'text-muted-foreground' : 'font-semibold text-foreground')}>
                {breadcrumb.section}
              </span>
              {breadcrumb.detail && (
                <>
                  <ChevronRight size={14} className="text-muted-foreground/60 shrink-0" />
                  <span className="font-semibold text-foreground truncate">{breadcrumb.detail}</span>
                </>
              )}
            </div>
          </div>

          {/* Right: Theme Toggle & Primary Assistant Action */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="md:hidden">
              <DataSourceBadge showFreshness={false} />
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              title={resolvedTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={resolvedTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="h-9 md:h-10 px-2.5 sm:px-3 rounded-lg border border-border bg-background hover:bg-muted text-foreground inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {resolvedTheme === 'dark' ? (
                <>
                  <Sun size={15} className="text-amber-400 shrink-0" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon size={15} className="text-muted-foreground shrink-0" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>

            {!isOnAssistant && (
              <Button
                type="button"
                onClick={() => navigate('/assistant')}
                className="h-9 md:h-10 px-3.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs md:text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                <MessageSquare size={15} className="mr-1.5" />
                Ask EDENS AI
              </Button>
            )}

            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
              className="md:hidden h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-destructive shrink-0 cursor-pointer"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation (5 Farmer-Facing Items, >=44px touch targets) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-card border-t border-border px-1 flex items-center justify-around"
      >
        {PRIMARY_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isItemActive =
            item.to === '/'
              ? location.pathname === '/'
              : Boolean(item.matchPrefix && location.pathname.startsWith(item.matchPrefix));

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={cn(
                'flex flex-col items-center justify-center min-h-[44px] min-w-[56px] px-2 py-1 rounded-lg gap-0.5 transition-colors whitespace-nowrap shrink-0',
                isItemActive ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon size={20} />
              <span className="text-[11px] leading-tight">{item.shortLabel}</span>
            </NavLink>
          );
        })}
      </nav>

      <OnboardingTour forceShow={forceTour} onClose={() => setForceTour(false)} />
    </div>
  );
}
