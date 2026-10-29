import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Sprout, X } from 'lucide-react';
import { Button } from './ui/button';

interface TourStep {
  title: string;
  content: string;
  route: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to EDENS AI',
    content:
      'Your Home page shows at a glance whether your greenhouse is connected, whether temperature, humidity, and soil moisture are within target, and what needs your attention.',
    route: '/'
  },
  {
    title: 'My Greenhouse',
    content:
      'Set up a new greenhouse in 6 guided steps, scan your EDENS kit QR code, check detailed sensor readings, or safely operate greenhouse equipment.',
    route: '/greenhouses'
  },
  {
    title: 'AI Assistant',
    content:
      'Ask farming questions by text or voice in English, Hausa, Yoruba, Igbo, Nigerian Pidgin, and more. EDENS AI explains clearly what data it is using.',
    route: '/assistant'
  },
  {
    title: 'Plant Vision',
    content:
      'Inspect the latest photograph from your greenhouse camera or upload a leaf photo from your phone to check for pests, nutrient stress, or disease.',
    route: '/vision'
  },
  {
    title: 'Settings & Technician Tools',
    content:
      'Choose your crop, language, and target climate ranges. Advanced hardware keys and connection diagnostics are neatly tucked inside Settings whenever a technician needs them.',
    route: '/settings'
  }
];

export function OnboardingTour({
  forceShow = false,
  onClose
}: {
  forceShow?: boolean;
  onClose?: () => void;
}) {
  // Do not block first-time farmers with a full-screen dark modal; only run when explicitly launched ("Take Quick Tour")
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (forceShow) {
      setStepIndex(0);
      setActive(true);
      if (location.pathname !== '/') {
        navigate('/');
      }
    }
  }, [forceShow, location.pathname, navigate]);

  if (!active) return null;

  const step = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  const handleClose = () => {
    localStorage.setItem('hasCompletedOnboarding', 'true');
    setActive(false);
    if (onClose) onClose();
  };

  const handleNext = () => {
    if (isLast) {
      handleClose();
      return;
    }
    const next = TOUR_STEPS[stepIndex + 1];
    setStepIndex(stepIndex + 1);
    if (location.pathname !== next.route) {
      navigate(next.route);
    }
  };

  const handlePrev = () => {
    if (stepIndex === 0) return;
    const prev = TOUR_STEPS[stepIndex - 1];
    setStepIndex(stepIndex - 1);
    if (location.pathname !== prev.route) {
      navigate(prev.route);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-tour-title"
        className="w-full max-w-md rounded-2xl border border-border bg-card text-foreground shadow-xl overflow-hidden"
      >
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${((stepIndex + 1) / TOUR_STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-6 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Sprout size={18} />
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">
                  Step {stepIndex + 1} of {TOUR_STEPS.length}
                </div>
                <h3 id="onboarding-tour-title" className="text-base font-bold text-foreground">
                  {step.title}
                </h3>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close tour"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">{step.content}</p>
        </div>

        <div className="px-6 py-4 bg-muted/50 border-t border-border flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Close Tour
          </button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={stepIndex === 0}
              onClick={handlePrev}
              className="h-9 px-3 rounded-lg cursor-pointer"
            >
              <ChevronLeft size={15} className="mr-1" /> Back
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleNext}
              className="h-9 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold cursor-pointer"
            >
              {isLast ? (
                <>
                  Done <Check size={15} className="ml-1" />
                </>
              ) : (
                <>
                  Next <ChevronRight size={15} className="ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
