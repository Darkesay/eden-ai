import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, Moon, Sprout, Sun, User } from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { ApiErrorKind } from '../lib/api';
import { useTheme } from '../lib/theme';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

const ERROR_HEADINGS: Record<ApiErrorKind, string> = {
  BACKEND_UNAVAILABLE: 'Backend Server Unavailable',
  API_ROUTE_MISCONFIGURED: 'API Routing Issue',
  INVALID_SERVER_RESPONSE: 'Unexpected Server Response',
  VALIDATION_ERROR: 'Check Your Information',
  DUPLICATE_EMAIL: 'Email Already Registered',
  RATE_LIMITED: 'Too Many Attempts',
  AUTH_OR_SESSION_FAILED: 'Authentication Error',
  REQUEST_FAILED: 'Unable to Complete Request'
};

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [userChoseTab, setUserChoseTab] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<{
    kind: ApiErrorKind;
    errorCode?: string;
    message: string;
  } | null>(null);

  const { user, loading, hasRegisteredUsers, login, register } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const fromState = (location.state as any)?.from;
  const redirectTarget = fromState
    ? `${fromState.pathname || '/'}${fromState.search || ''}`
    : '/';

  useEffect(() => {
    if (!loading && user) {
      navigate(redirectTarget, { replace: true });
    }
  }, [loading, user, navigate, redirectTarget]);

  useEffect(() => {
    if (!userChoseTab && hasRegisteredUsers === false) {
      setMode('register');
    }
  }, [hasRegisteredUsers, userChoseTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorState(null);

    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setErrorState({
        kind: 'VALIDATION_ERROR',
        message: 'Enter a valid email address (for example, amina@farm.ng).'
      });
      return;
    }

    if (mode === 'register') {
      if (!displayName.trim()) {
        setErrorState({
          kind: 'VALIDATION_ERROR',
          message: 'Enter your name or farm name to create your account.'
        });
        return;
      }
      if (password.length < 8) {
        setErrorState({
          kind: 'VALIDATION_ERROR',
          message: 'Password must be at least 8 characters long.'
        });
        return;
      }
    }

    setSubmitting(true);

    try {
      if (mode === 'login') {
        const res = await login(normalizedEmail, password);
        if (!res.ok) {
          setErrorState({ kind: res.kind, errorCode: res.errorCode, message: res.message });
          return;
        }
        navigate(redirectTarget, { replace: true });
      } else {
        const res = await register(displayName.trim(), normalizedEmail, password);
        if (!res.ok) {
          setErrorState({ kind: res.kind, errorCode: res.errorCode, message: res.message });
          return;
        }
        navigate(fromState ? redirectTarget : '/', { replace: true });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center p-4 sm:p-6 font-sans relative">
      <div className="fixed top-4 right-4 sm:top-6 sm:right-6 z-10">
        <button
          type="button"
          onClick={toggleTheme}
          title={resolvedTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label={resolvedTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="h-10 px-3 rounded-xl border border-border bg-card hover:bg-muted text-foreground inline-flex items-center gap-1.5 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          {resolvedTheme === 'dark' ? (
            <>
              <Sun size={15} className="text-amber-400" />
              <span>Light Mode</span>
            </>
          ) : (
            <>
              <Moon size={15} className="text-muted-foreground" />
              <span>Dark Mode</span>
            </>
          )}
        </button>
      </div>

      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Sprout size={26} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            EDENS AI
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Simple greenhouse monitoring, plant health vision, and crop guidance in your preferred language.
          </p>
        </div>

        <Card className="bg-card border border-border shadow-sm rounded-2xl">
          <CardHeader className="pb-4 pt-6 px-6">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted border border-border">
              <button
                type="button"
                onClick={() => {
                  setUserChoseTab(true);
                  setMode('login');
                  setErrorState(null);
                }}
                className={`h-10 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'login'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setUserChoseTab(true);
                  setMode('register');
                  setErrorState(null);
                }}
                className={`h-10 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'register'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Create Account
              </button>
            </div>
            <CardTitle className="text-lg font-semibold pt-3">
              {mode === 'login' ? 'Welcome back' : 'Create your farmer account'}
            </CardTitle>
            <CardDescription>
              {mode === 'login'
                ? 'Sign in to check your greenhouse readings and crop health.'
                : 'Register once to connect your EDENS AI greenhouse kit or explore in practice mode.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="px-6 pb-6 space-y-4">
            {errorState && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/45 dark:text-red-200 px-4 py-3 text-sm"
              >
                <AlertCircle size={17} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-red-950 dark:text-red-100 leading-snug">
                    {ERROR_HEADINGS[errorState.kind]}
                  </p>
                  <p className="text-xs sm:text-sm leading-relaxed">{errorState.message}</p>
                  {errorState.kind === 'DUPLICATE_EMAIL' && mode === 'register' && (
                    <button
                      type="button"
                      onClick={() => {
                        setUserChoseTab(true);
                        setMode('login');
                        setErrorState(null);
                      }}
                      className="mt-1 inline-flex items-center text-xs font-semibold underline underline-offset-2 text-red-800 dark:text-red-300 cursor-pointer"
                    >
                      Switch to Sign In →
                    </button>
                  )}
                  {errorState.errorCode === 'INVALID_CREDENTIALS' && mode === 'login' && (
                    <div className="pt-0.5 space-y-1">
                      <p className="text-xs text-red-800/90 dark:text-red-300/90">
                        Use the eye icon below to verify your password, or create a new account if you have not registered on this server yet.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setUserChoseTab(true);
                          setMode('register');
                          setErrorState(null);
                        }}
                        className="inline-flex items-center text-xs font-semibold underline underline-offset-2 text-red-800 dark:text-red-300 cursor-pointer"
                      >
                        Need an account? Switch to Create Account →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="login-name" className="text-sm font-medium">
                    Your Name or Farm Name
                  </Label>
                  <div className="relative">
                    <User size={17} className="absolute left-3.5 top-3 text-muted-foreground" />
                    <Input
                      id="login-name"
                      placeholder="e.g. Amina Bello / Green Acres Farm"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      required
                      className="pl-10 h-11 rounded-xl bg-background border-input text-sm"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="login-email" className="text-sm font-medium">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail size={17} className="absolute left-3.5 top-3 text-muted-foreground" />
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-10 h-11 rounded-xl bg-background border-input text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password" className="text-sm font-medium">
                  Password
                </Label>
                <div className="relative">
                  <Lock size={17} className="absolute left-3.5 top-3 text-muted-foreground" />
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={mode === 'register' ? 8 : 1}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    className="pl-10 pr-10 h-11 rounded-xl bg-background border-input text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-2.5 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm mt-2 cursor-pointer"
              >
                {submitting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : mode === 'login' ? (
                  'Sign In'
                ) : (
                  'Create Account'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-primary" /> Live sensor &amp; camera checks
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-primary" /> 8 Nigerian languages + English
          </span>
        </div>
      </div>
    </div>
  );
}
