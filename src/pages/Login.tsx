import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Lock, Mail, Sprout, User } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
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
    : '/greenhouses';

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
        navigate(fromState ? redirectTarget : '/greenhouses', { replace: true });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#040404] text-[#F0F0F0] p-4 font-sans">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-[#10B981]/5 blur-[120px] rounded-full" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-[#10B981]/5 blur-[120px] rounded-full" />
      </div>

      <Card className="w-full max-w-md bg-[#080808] border-[#1A2A1A] z-10 shadow-2xl rounded-3xl overflow-hidden">
        <CardHeader className="space-y-3 pb-5 pt-8 text-center">
          <div className="mx-auto w-12 h-12 bg-[#1A2A1A] rounded-2xl flex items-center justify-center border border-[#10B981]/30 text-[#10B981] mb-1">
            <Sprout size={28} />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight text-white flex flex-col items-center gap-1">
            <span className="text-[#10B981]">EDENS AI</span>
          </CardTitle>
          <CardDescription className="text-[#808080] text-sm tracking-wide flex flex-col items-center gap-1">
            <span>Self-Service Smart Greenhouse Platform</span>
            <span className="text-[10px] uppercase font-bold tracking-[0.08em] text-[#10B981]/70">
              Powered by RA
            </span>
          </CardDescription>
        </CardHeader>

        <CardContent className="px-8 pb-9 space-y-5">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#040404] border border-[#1A2A1A]">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg('');
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                mode === 'login'
                  ? 'bg-[#10B981] text-black'
                  : 'text-[#9CA3AF] hover:text-white'
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
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                mode === 'register'
                  ? 'bg-[#10B981] text-black'
                  : 'text-[#9CA3AF] hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          {errorMsg && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="relative">
                <div className="absolute left-3 top-3.5 text-[#10B981]/60">
                  <User size={18} />
                </div>
                <Input
                  placeholder="Grower / Farm Name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  className="pl-10 bg-[#040404] border-[#1A2A1A] focus-visible:ring-[#10B981] text-[#F0F0F0] rounded-xl h-12"
                />
              </div>
            )}

            <div className="relative">
              <div className="absolute left-3 top-3.5 text-[#10B981]/60">
                <Mail size={18} />
              </div>
              <Input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="pl-10 bg-[#040404] border-[#1A2A1A] focus-visible:ring-[#10B981] text-[#F0F0F0] rounded-xl h-12"
              />
            </div>

            <div className="relative">
              <div className="absolute left-3 top-3.5 text-[#10B981]/60">
                <Lock size={18} />
              </div>
              <Input
                type="password"
                placeholder={mode === 'register' ? 'Password (min 8 characters)' : 'Password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 8 : 1}
                className="pl-10 bg-[#040404] border-[#1A2A1A] focus-visible:ring-[#10B981] text-[#F0F0F0] rounded-xl h-12"
              />
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#10B981] hover:bg-[#059669] text-black font-semibold tracking-wide rounded-xl h-12 transition-all mt-2"
            >
              {submitting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : mode === 'login' ? (
                'Sign In to EDENS AI'
              ) : (
                'Create Grower Account'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
