import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { ChevronRight, ChevronLeft, Check, Sparkles, Sprout } from 'lucide-react';
import { Button } from './ui/button';

const TOUR_STEPS = [
  {
    target: 'body',
    title: 'Your Command Center',
    content: 'This is your Control Center. From here, you monitor your entire greenhouse in real time — temperature, humidity, soil moisture, light levels, and more. All updated live from your sensors.',
    route: '/',
    isCenter: true,
  },
  {
    target: '#tour-env-gauges',
    title: 'Environment',
    content: 'Your environment gauges show real-time temperature, humidity, and sub-indicators like Coldness, Hotness, Dryness, and Wetness. EDEN monitors these 24/7 to keep your plants in the perfect climate.',
    route: '/',
  },
  {
    target: '#tour-water-system',
    title: 'Water System',
    content: 'Track your water system at a glance. Soil moisture, water reservoir level, rain status, and rain collection — everything you need to manage irrigation efficiently.',
    route: '/',
  },
  {
    target: '#tour-device-controls',
    title: 'Device Controls',
    content: 'Control your greenhouse hardware with a single tap. Toggle heaters, fans, pumps, lights, and even the automated roof. Every action is logged for complete traceability.',
    route: '/',
  },
  {
    target: '#tour-ai-camera',
    title: 'AI Lab',
    content: "Meet EDEN, your AI plant health expert. Capture a photo of any plant, and EDEN instantly analyzes its health — identifying diseases, symptoms, and recommending treatment. Tap 'Enable Auto-Scan' to let EDEN monitor your plants automatically every 30 minutes.",
    route: '/ai-lab',
  },
  {
    target: '#tour-device-management',
    title: 'Device Management',
    content: 'Connect all your hardware here. Register ESP32s, Raspberry Pis, Arduino boards, or Linux devices. Each device gets a secure token for authentication. Monitor their connection status in real time.',
    route: '/devices',
  },
  {
    target: 'body',
    title: "You're All Set, Farmer!",
    content: "Your greenhouse is now being monitored by EDENS AI, powered by RA. Explore the dashboard, check your Activity Log to see autonomous decisions, and watch your crops thrive.",
    subtitle: "Happy growing! 🌱",
    route: '/',
    isCenter: true,
    isFinal: true,
  }
];

export function OnboardingTour({ forceShow = false, onClose }: { forceShow?: boolean; onClose?: () => void }) {
  const [hasSeen, setHasSeen] = useState(() => localStorage.getItem('hasCompletedOnboarding') === 'true');
  const [stepIndex, setStepIndex] = useState(-1);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const isVisible = forceShow || !hasSeen;

  useEffect(() => {
    const handleReplay = () => {
      setHasSeen(false);
      setStepIndex(-1);
      localStorage.removeItem('hasCompletedOnboarding');
      navigate('/');
    };
    window.addEventListener('replay-tour', handleReplay);
    return () => window.removeEventListener('replay-tour', handleReplay);
  }, [navigate]);

  const skipTour = () => {
    if (stepIndex === -1 && !confirm("You can replay this tour anytime in Settings → Replay Onboarding Tour.")) {
      return;
    }
    localStorage.setItem('hasCompletedOnboarding', 'true');
    setHasSeen(true);
    if (onClose) onClose();
  };

  const playDing = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch(e) {}
  };

  const nextStep = () => {
    if (stepIndex < TOUR_STEPS.length - 1) {
      if (stepIndex >= 0) playDing();
      const next = TOUR_STEPS[stepIndex + 1];
      if (next.route !== location.pathname) navigate(next.route);
      setStepIndex(stepIndex + 1);
    } else {
      localStorage.setItem('hasCompletedOnboarding', 'true');
      setHasSeen(true);
      if (onClose) onClose();
    }
  };

  const prevStep = () => {
    if (stepIndex > 0) {
      const prev = TOUR_STEPS[stepIndex - 1];
      if (prev.route !== location.pathname) navigate(prev.route);
      setStepIndex(stepIndex - 1);
    }
  };

  // Keyboard and swipe navigation
  useEffect(() => {
    if (!isVisible || stepIndex === -1) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skipTour();
      if (e.key === 'ArrowRight') nextStep();
      if (e.key === 'ArrowLeft') prevStep();
    };
    window.addEventListener('keydown', handleKeyDown);

    let touchStartX = 0;
    const handleTouchStart = (e: TouchEvent) => { touchStartX = e.touches[0].clientX; };
    const handleTouchEnd = (e: TouchEvent) => {
      const touchEndX = e.changedTouches[0].clientX;
      if (touchStartX - touchEndX > 50) nextStep();
      else if (touchEndX - touchStartX > 50) prevStep();
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isVisible, stepIndex, location.pathname]);

  // Update target rect
  useEffect(() => {
    if (!isVisible || stepIndex === -1) return;
    const currentStep = TOUR_STEPS[stepIndex];
    if (currentStep.isCenter) {
      setTargetRect(null);
      return;
    }

    const updateRect = () => {
      const el = document.querySelector(currentStep.target);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      } else {
        setTargetRect(null);
      }
    };

    updateRect();
    const interval = setInterval(updateRect, 100);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect);
    };
  }, [stepIndex, isVisible, location.pathname]);

  if (!isVisible) return null;

  // --- WELCOME SCREEN ---
  if (stepIndex === -1) {
    return (
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black text-white flex flex-col items-center justify-center p-6 overflow-hidden"
      >
        <div className="absolute inset-0 z-0 opacity-40">
           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] max-w-[800px] max-h-[800px] bg-[#10B981] rounded-full mix-blend-screen filter blur-[120px] animate-pulse" />
        </div>
        
        <div className="z-10 flex flex-col items-center max-w-lg text-center space-y-8">
           <motion.div 
             initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2, type: "spring", stiffness: 100 }}
             className="relative flex items-center justify-center"
           >
             <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#10B981] to-emerald-900 flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(16,185,129,0.5)]">
               <Sprout size={48} className="text-white" />
             </div>
           </motion.div>
           
           <div className="space-y-4">
             <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }} className="text-4xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
               Welcome to EDENS AI
             </motion.h1>
             <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6 }} className="text-lg md:text-xl text-gray-400">
               Your intelligent greenhouse, powered by RA.
             </motion.p>
           </div>

           {/* Simple plant growth animation representation */}
           <motion.div 
             initial={{ height: 0, opacity: 0 }} animate={{ height: 80, opacity: 1 }} transition={{ delay: 1, duration: 3, ease: "easeOut" }}
             className="w-1 bg-gradient-to-t from-emerald-900 via-emerald-500 to-[#10B981] rounded-full relative overflow-visible flex justify-center"
           >
             <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 3, type: "spring" }} className="absolute -top-4 text-[#10B981]">
                <Sprout size={32} />
             </motion.div>
           </motion.div>

           <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1.5 }} className="flex flex-col gap-4 w-full pt-8">
             <button onClick={nextStep} className="group relative w-full flex items-center justify-center gap-2 bg-gradient-to-r from-[#10B981] to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-bold tracking-wide h-14 rounded-2xl shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all hover:shadow-[0_0_40px_rgba(16,185,129,0.5)] hover:scale-[1.02]">
               <Sparkles size={20} className="group-hover:animate-spin" /> Take the Tour
             </button>
             <button onClick={skipTour} className="text-sm text-gray-500 hover:text-white transition-colors underline underline-offset-4">
               Skip to Dashboard
             </button>
           </motion.div>
        </div>
      </motion.div>
    );
  }

  const currentStep = TOUR_STEPS[stepIndex];

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center overflow-hidden">
      {/* Target Highlight Glow & Overlay */}
      {targetRect && !currentStep.isCenter ? (
        <motion.div
           layout
           initial={{ opacity: 0, scale: 0.9 }}
           animate={{ opacity: 1, scale: 1.03 }}
           exit={{ opacity: 0 }}
           transition={{ type: "spring", stiffness: 100, damping: 20 }}
           className="absolute border-2 border-[#10B981] rounded-3xl pointer-events-none z-[101]"
           style={{
             top: targetRect.top - 8,
             left: targetRect.left - 8,
             width: targetRect.width + 16,
             height: targetRect.height + 16,
             boxShadow: '0 0 0 9999px rgba(0,0,0,0.7), 0 0 30px rgba(16,185,129,0.6), inset 0 0 20px rgba(16,185,129,0.2)'
           }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-all duration-500 pointer-events-auto z-[101]" />
      )}

      {/* Confetti on Final Step */}
      {currentStep.isFinal && (
         <div className="absolute inset-0 pointer-events-none z-[105] flex items-center justify-center overflow-hidden">
           {[...Array(50)].map((_, i) => (
             <motion.div
               key={i}
               initial={{ opacity: 1, scale: 0, x: 0, y: 0 }}
               animate={{ 
                 opacity: 0, 
                 scale: Math.random() * 2 + 1,
                 x: (Math.random() - 0.5) * window.innerWidth * 1.5,
                 y: (Math.random() - 0.5) * window.innerHeight * 1.5,
                 rotate: Math.random() * 360
               }}
               transition={{ duration: 2 + Math.random(), ease: "easeOut" }}
               className="absolute w-3 h-3 bg-[#10B981] rounded-sm"
               style={{ backgroundColor: ['#10B981', '#34D399', '#059669', '#FBBF24'][Math.floor(Math.random() * 4)] }}
             />
           ))}
         </div>
      )}

      {/* Tooltip Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stepIndex}
          role="dialog"
          aria-live="polite"
          aria-labelledby={`tour-title-${stepIndex}`}
          aria-describedby={`tour-desc-${stepIndex}`}
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
          className={cn(
            "pointer-events-auto absolute z-[102] bg-white/90 dark:bg-[#080808]/90 backdrop-blur-xl border border-[#D1E8D1] dark:border-[#10B981]/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col",
            currentStep.isCenter ? "w-full max-w-md mx-4" : "w-[calc(100%-32px)] max-w-sm mx-4 sm:mx-0"
          )}
          style={
            !currentStep.isCenter && targetRect
              ? {
                  top: targetRect.bottom + 16 + 250 > window.innerHeight 
                        ? Math.max(16, targetRect.top - 250 - 16) 
                        : targetRect.bottom + 16,
                  left: Math.max(16, Math.min(window.innerWidth - 384 - 16, targetRect.left + targetRect.width/2 - 192)),
                  position: 'absolute'
                }
              : { position: 'relative' }
          }
        >
           <div className="absolute top-0 left-0 right-0 h-1 bg-[#10B981]/20">
             <motion.div 
               className="h-full bg-[#10B981]" 
               initial={{ width: 0 }} 
               animate={{ width: `${((stepIndex + 1) / TOUR_STEPS.length) * 100}%` }} 
             />
           </div>

           <div className="p-6 pt-8 space-y-4">
             {currentStep.isFinal && (
               <div className="flex justify-center mb-4 text-[#10B981] animate-bounce">
                  <Check size={48} className="drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
               </div>
             )}
             
             <div className={cn("space-y-2", currentStep.isCenter && "text-center")}>
                <h3 id={`tour-title-${stepIndex}`} className="text-xl font-bold tracking-tight flex items-center justify-center gap-2">
                   {currentStep.title} {currentStep.isFinal && <Sprout size={20} className="text-[#10B981]" />}
                </h3>
                <p id={`tour-desc-${stepIndex}`} className="text-sm opacity-80 leading-relaxed text-[#1A1A1A] dark:text-[#E2E8F0]">{currentStep.content}</p>
                {currentStep.subtitle && <p className="text-sm font-bold text-[#10B981] mt-2">{currentStep.subtitle}</p>}
             </div>
           </div>

           <div className="p-4 bg-black/5 dark:bg-white/5 border-t border-[#D1E8D1] dark:border-[#1A2A1A] flex items-center justify-between">
             <button onClick={skipTour} className="text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors underline underline-offset-2">
               Skip Tour
             </button>
             <div className="flex gap-4 items-center">
                <div className="flex gap-1.5 hidden sm:flex">
                  {TOUR_STEPS.map((_, i) => (
                    <div key={i} className={cn("h-1.5 rounded-full transition-all duration-300", i === stepIndex ? "bg-[#10B981] w-4" : "bg-gray-300 dark:bg-gray-700 w-1.5")} />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button onClick={prevStep} variant="outline" size="icon" className="h-9 w-9 rounded-xl pointer-events-auto" disabled={stepIndex === 0}>
                    <ChevronLeft size={16} />
                  </Button>
                  <Button onClick={nextStep} className="bg-[#10B981] hover:bg-[#059669] text-white font-bold h-9 px-4 rounded-xl pointer-events-auto shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    {currentStep.isFinal ? (
                      <span className="flex items-center gap-1">Finish <Check size={16} /></span>
                    ) : (
                      <span className="flex items-center gap-1">Next <ChevronRight size={16} /></span>
                    )}
                  </Button>
                </div>
             </div>
           </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

