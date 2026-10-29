import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, Lock, Mail, Sprout, User } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const { user, loading, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const fromState = (location.state as any)?.from;
  const redirectTarget = fromState
    ? `${fromState.pathname || '/'}${fromState.search || ''}`
    : '/';

  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, []);

  useEffect(() => {
    if (!loading && user) {
      navigate(redirectTarget, { replace: true });
    }
  }, [loading, user, navigate, redirectTarget]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);

    try {
      if (mode === 'login') {
        const res = await login(email, password);
        if ('message' in res) {
          setErrorMsg(res.message);
          return;
        }
        navigate(redirectTarget, { replace: true });
      } else {
        const res = await register(displayName, email, password);
        if ('message' in res) {
          setErrorMsg(res.message);
          return;
        }
        navigate(fromState ? redirectTarget : '/', { replace: true });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center p-4 sm:p-6 font-sans">
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
                  setMode('login');
                  setErrorMsg('');
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
                  setMode('register');
                  setErrorMsg('');
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
            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {errorMsg}
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
                    type="password"
                    placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={mode === 'register' ? 8 : 1}
                    className="pl-10 h-11 rounded-xl bg-background border-input text-sm"
                  />
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
