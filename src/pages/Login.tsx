import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Sprout } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate login
    if (username && password) {
      localStorage.setItem('botanix_auth', 'true');
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#040404] text-[#F0F0F0] p-4 font-sans">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-[#10B981]/5 blur-[120px] rounded-full" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-[#10B981]/5 blur-[120px] rounded-full" />
      </div>
      
      <Card className="w-full max-w-md bg-[#080808] border-[#1A2A1A] z-10 shadow-2xl rounded-3xl overflow-hidden">
        <CardHeader className="space-y-3 pb-6 pt-8 text-center">
          <div className="mx-auto w-12 h-12 bg-[#1A2A1A] rounded-2xl flex items-center justify-center border border-[#10B981]/30 text-[#10B981] mb-2">
            <Sprout size={28} />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight text-white flex flex-col items-center gap-2">
            <span className="text-[#10B981]">EDENS AI</span>
          </CardTitle>
          <CardDescription className="text-[#808080] text-sm tracking-wide flex flex-col items-center gap-1 mt-2">
            <span>Your greenhouse, perfectly managed.</span>
            <span className="text-[10px] uppercase font-bold tracking-[0.05em] text-[#10B981]/70 mt-1">Powered by RA</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="px-8 pb-10">
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1 relative">
              <div className="absolute left-3 top-2.5 text-[#10B981]/60">
                <User size={18} />
              </div>
              <Input
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="pl-10 bg-[#040404] border-[#1A2A1A] focus-visible:ring-[#10B981] text-[#F0F0F0] rounded-xl h-12"
              />
            </div>
            <div className="space-y-1 relative">
              <div className="absolute left-3 top-2.5 text-[#10B981]/60">
                <Lock size={18} />
              </div>
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 bg-[#040404] border-[#1A2A1A] focus-visible:ring-[#10B981] text-[#F0F0F0] rounded-xl h-12"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full bg-[#10B981] hover:bg-[#059669] text-black font-semibold tracking-wide rounded-xl h-12 transition-all mt-6"
            >
              Sign In
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
