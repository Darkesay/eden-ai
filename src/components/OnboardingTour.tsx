import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { ChevronRight, ChevronLeft, Check, Sprout } from 'lucide-react';
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
    subtitle: "Happy growing!",
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
        className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-6"
      >
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sprout size={24} aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold">Welcome to EDENS AI</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your intelligent greenhouse, powered by RA. Take a short tour to learn your way around.
          </p>
          <div className="mt-7 flex flex-col items-center gap-3">
            <Button type="button" className="w-full" onClick={nextStep}>
              Start tour
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={skipTour}>
              Skip
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  const currentStep = TOUR_STEPS[stepIndex];

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center overflow-hidden">
      {/* Target Highlight Ring & Overlay */}
      {targetRect && !currentStep.isCenter ? (
        <motion.div
           layout
           initial={{ opacity: 0, scale: 0.98 }}
           animate={{ opacity: 1, scale: 1 }}
           exit={{ opacity: 0 }}
           transition={{ type: "spring", stiffness: 150, damping: 22 }}
           className="absolute rounded-xl border-2 border-brand/70 pointer-events-none z-[101]"
           style={{
             top: targetRect.top - 8,
             left: targetRect.left - 8,
             width: targetRect.width + 16,
             height: targetRect.height + 16,
             boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)'
           }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55 transition-all duration-500 pointer-events-auto z-[101]" />
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
            "pointer-events-auto absolute z-[102] bg-popover border border-border rounded-xl shadow-lg overflow-hidden flex flex-col",
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
           <div className="absolute top-0 left-0 right-0 h-1 bg-muted">
             <motion.div 
               className="h-full bg-primary" 
               initial={{ width: 0 }} 
               animate={{ width: `${((stepIndex + 1) / TOUR_STEPS.length) * 100}%` }} 
             />
           </div>

           <div className="p-6 pt-7 space-y-4">
             {currentStep.isFinal && (
               <div className="flex justify-center text-brand">
                 <Check size={28} aria-hidden="true" />
               </div>
             )}
             
             <div className={cn("space-y-2", currentStep.isCenter && "text-center")}>
                <h3 id={`tour-title-${stepIndex}`} className="text-sm font-semibold flex items-center justify-center gap-2">
                   {currentStep.title}
                </h3>
                <p id={`tour-desc-${stepIndex}`} className="text-sm leading-relaxed text-muted-foreground">{currentStep.content}</p>
                {currentStep.subtitle && <p className="text-sm font-medium text-foreground mt-2">{currentStep.subtitle}</p>}
             </div>
           </div>

           <div className="p-4 bg-muted/50 border-t border-border flex items-center justify-between gap-3">
             <Button onClick={skipTour} variant="ghost" size="sm" className="text-muted-foreground">
               Skip
             </Button>
             <div className="flex gap-4 items-center">
                <div className="flex gap-1.5 hidden sm:flex" aria-hidden="true">
                  {TOUR_STEPS.map((_, i) => (
                    <div key={i} className={cn("h-1.5 rounded-full transition-all duration-300", i === stepIndex ? "bg-brand w-4" : "bg-border w-1.5")} />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button onClick={prevStep} variant="outline" size="icon" className="pointer-events-auto" disabled={stepIndex === 0} aria-label="Previous step" title="Previous step">
                    <ChevronLeft size={16} aria-hidden="true" />
                  </Button>
                  <Button onClick={nextStep} size="sm" className="pointer-events-auto">
                    {currentStep.isFinal ? (
                      <span className="flex items-center gap-1">Finish <Check size={16} aria-hidden="true" /></span>
                    ) : (
                      <span className="flex items-center gap-1">Next <ChevronRight size={16} aria-hidden="true" /></span>
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

