import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  ArrowUp,
  TrendingDown,
  Camera,
  Cpu,
  Radio,
  MessageSquare,
  Bell,
  Radar,
  Stethoscope,
  Droplets,
  WifiOff,
  Wallet,
  Cpu as CpuIcon,
  Sprout,
  Lightbulb,
  HeartHandshake,
  Zap,
  Gauge,
  Accessibility,
  Menu,
  X as XClose,
  X as XIcon,
  Mail,
  MapPin,
  Globe,
  Twitter,
  Youtube,
  Linkedin,
  Check,
  Pause,
  Play,
  Signal,
  BatteryFull
} from 'lucide-react';
import { buttonVariants } from '../components/ui/button';
import { cn } from '../lib/utils';
import { EASE_STANDARD } from '../lib/motion';

/**
 * Eden AI landing page — the default entry point of the app (/).
 * Brand system from the official artwork (deep botanical green, warm paper,
 * fresh green accent, leaf-circuit mark); layout and copy are grounded in
 * Plateau State, Nigeria. Photography: Pexels, Nigerian farmers, lazy-loaded
 * and width-constrained.
 */

/* Verified Pexels CDN URLs (all 200 image/jpeg). */
const photo = (id: string, w: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;

const HERO_PHOTO = photo('34411658', 1920); // Nigerian farmer examining crops in an open field
const PROBLEM_PHOTO = photo('34411687', 900); // African farmer inspecting crops
const SENSOR_PHOTO = photo('16905006', 900); // Environmental sensor in a greenhouse
const POTATO_PHOTO = photo('31908568', 800); // Lush green potato field
const TOMATO_PHOTO = photo('34705725', 800); // African farmers harvesting tomatoes in Nigeria
const MAIZE_PHOTO = photo('39234869', 800); // Lush cornfield
const IMPACT_PHOTO = photo('34705723', 900); // Smiling female farmer in a Nigerian field

const NAV_LINKS = [
  { href: '#solution', label: 'Technology' },
  { href: '#mission', label: 'Our Mission' },
  { href: '#crops', label: 'Our Crops' },
  { href: '#impact', label: 'Our Impact' },
  { href: '#contact', label: 'Contact' }
];

const MARQUEE_ITEMS = [
  'Irish potatoes',
  'Tomatoes',
  'Maize',
  'Plateau State',
  'AI disease detection',
  'Offline-first sensors',
  'SMS & WhatsApp alerts',
  'Sensor-as-a-Service'
];

const PROBLEMS = [
  {
    icon: Stethoscope,
    title: 'Late detection of crop diseases',
    body: 'By the time damage is visible to the eye, a season of yield can already be lost.'
  },
  {
    icon: Droplets,
    title: 'Unpredictable soil conditions',
    body: 'Moisture and nutrient levels shift underground, where farmers cannot see them.'
  },
  {
    icon: CpuIcon,
    title: 'Limited access to modern agricultural technology',
    body: 'Monitoring tools exist — but they were not built for rural realities.'
  },
  {
    icon: WifiOff,
    title: 'Poor internet connectivity',
    body: 'Most field technology assumes constant internet. Rural fields rarely have it.'
  },
  {
    icon: Wallet,
    title: 'High cost of automated farming equipment',
    body: 'Upfront hardware costs put intelligent farming out of reach for the farmers who need it most.'
  }
];

const SOLUTION_CARDS = [
  {
    icon: Camera,
    title: 'AI-powered cameras',
    body: 'Field cameras watch crop health continuously, spotting the earliest signs of disease before they spread.'
  },
  {
    icon: Cpu,
    title: 'Underground soil sensors',
    body: 'Buried probes track moisture, temperature, and soil conditions around the clock — where the crop actually grows.'
  },
  {
    icon: Radio,
    title: 'Local communication networks',
    body: 'Devices talk to each other through local networks that keep working without depending on continuous internet access.'
  },
  {
    icon: MessageSquare,
    title: 'SMS and WhatsApp alerts',
    body: 'Clear, understandable notifications reach the farmer directly on their phone, with actionable recommendations.'
  }
];

const CROPS = [
  {
    photo: POTATO_PHOTO,
    alt: 'Lush green Irish potato field',
    name: 'Irish Potatoes',
    note: 'Late blight and soil moisture stress',
    body: 'A flagship crop of the Plateau highlands — sensitive to exactly the pressures Eden AI detects early.'
  },
  {
    photo: TOMATO_PHOTO,
    alt: 'African farmers harvesting fresh tomatoes in Nigeria',
    name: 'Tomatoes',
    note: 'Perishable and high-value',
    body: 'A few days of undetected disease can erase an entire season of profit. Early warning is everything.'
  },
  {
    photo: MAIZE_PHOTO,
    alt: 'Lush green maize field under a clear sky',
    name: 'Maize',
    note: 'Household food security',
    body: 'A staple across Nigeria. Protecting maize yields protects food security and farm income.'
  }
];

const IMPACTS = [
  { icon: Sprout, body: 'Empowering rural farmers with information they can act on.' },
  { icon: Lightbulb, body: 'Creating opportunities for young people in agricultural technology.' },
  { icon: HeartHandshake, body: 'Supporting women in agriculture with tools built for everyday use.' },
  { icon: Zap, body: 'Promoting accessible agricultural innovation that works in low-connectivity environments.' },
  { icon: Gauge, body: 'Improving agricultural decision-making with timely, understandable data.' },
  { icon: Accessibility, body: 'Expanding access to technology for underserved communities, including persons with disabilities.' }
];

/* ------------------------------------------------------------------ */
/* Brand mark — official EDENS AI logo (public/logo2.png)              */
/* ------------------------------------------------------------------ */

function Logo({
  variant = 'dark',
  size = 32,
  className
}: {
  variant?: 'dark' | 'light';
  size?: number;
  className?: string;
}) {
  if (variant === 'light') {
    // On dark surfaces the dark circuit traces need a light ground — a paper tile
    return (
      <span className={cn('flex shrink-0 items-center gap-2.5', className)}>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#F6F7F6] shadow-sm">
          <img src="/logo2.png" alt="" width={size} height={size} draggable={false} />
        </span>
        <span className="text-[17px] font-semibold tracking-tight text-[#F6F7F6]">
          Eden <span className="text-[#A3E635]">AI</span>
        </span>
      </span>
    );
  }
  return (
    <span className={cn('flex shrink-0 items-center gap-2.5', className)}>
      <img src="/logo2.png" alt="" width={size} height={size} draggable={false} />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        Eden <span className="text-primary">AI</span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

/** Section reveal — subtle fade + rise, once, on scroll into view. */
function Reveal({
  children,
  className,
  delay = 0
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-72px' }}
      transition={{ duration: 0.5, delay, ease: EASE_STANDARD }}
    >
      {children}
    </motion.div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  children,
  onDark = false
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  onDark?: boolean;
}) {
  return (
    <div className="max-w-2xl">
      <p className={cn('text-[11px] font-semibold tracking-[0.08em]', onDark ? 'text-[#E6F2EB]' : 'text-brand')}>
        {eyebrow}
      </p>
      <h2
        className={cn(
          'mt-3 text-balance text-3xl font-semibold leading-[1.12] tracking-[-0.02em] sm:text-4xl',
          onDark ? 'text-white' : 'text-foreground'
        )}
      >
        {title}
      </h2>
      {children ? (
        <div className={cn('mt-4 text-sm leading-relaxed sm:text-base', onDark ? 'text-white/85' : 'text-muted-foreground')}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Scroll progress hairline — sits at the top edge of the sticky header. */
function ScrollProgressBar() {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        if (barRef.current) barRef.current.style.transform = `scaleX(${progress})`;
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden">
      <div ref={barRef} className="h-full w-full origin-left bg-primary" style={{ transform: 'scaleX(0)' }} />
    </div>
  );
}

/** Back to top — appears after a few viewportfuls of scroll. */
function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVisible(window.scrollY > 640));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const goTop = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={goTop}
      aria-label="Back to top"
      className={cn(
        'fixed right-5 bottom-5 z-40 flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-[opacity,transform,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        visible ? 'pointer-events-auto opacity-100 translate-y-0' : 'pointer-events-none translate-y-3 opacity-0'
      )}
    >
      <ArrowUp size={18} aria-hidden="true" />
    </button>
  );
}

/** Field node panel — the hero's product instrument, live telemetry at a glance. */
function FieldNodePanel() {
  const nodes = [
    { icon: Camera, label: 'AI crop camera', status: 'Watching' },
    { icon: Cpu, label: 'On-device AI', status: 'Learning' },
    { icon: Radio, label: 'Local mesh network', status: 'Connected' },
    { icon: MessageSquare, label: 'SMS · WhatsApp alerts', status: 'Delivering' }
  ];
  return (
    <div className="group relative w-full glass-panel rounded-2xl p-5 transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:shadow-2xl">
      {/* floating trend badge — pulls the eye once, then stays quiet */}
      <span className="absolute -right-3 -top-4 hidden items-center gap-1.5 whitespace-nowrap rounded-full glass-chip px-3 py-1.5 text-[11px] font-semibold text-[#92400E] shadow-md sm:flex">
        <TrendingDown size={13} aria-hidden="true" />
        −12% moisture · 7d
      </span>

      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl glass-chip">
            <img src="/logo2.png" alt="" width={22} height={22} draggable={false} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">Field node</span>
            <span className="block truncate font-mono text-[10px] leading-tight text-muted-foreground">
              PLOT 3 · IRISH POTATO
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="flex h-3.5 items-end gap-[3px]" aria-hidden="true">
            {[10, 14, 12, 7].map((h, i) => (
              <span key={i} className="eq-bar w-[3px] rounded-sm bg-primary" style={{ height: h }} />
            ))}
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] font-medium text-success">
            <span className="relative flex size-1.5">
              <span className="live-ring absolute inline-flex h-full w-full rounded-full bg-success" aria-hidden="true" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            LIVE
          </span>
        </span>
      </div>

      {/* Hero metric — the one number a farmer would open the app for */}
      <div className="mt-4 flex items-end justify-between gap-3 border-b border-foreground/10 pb-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] text-muted-foreground">SOIL MOISTURE · 25 CM</p>
          <p className="mt-1.5 flex items-baseline gap-2.5">
            <span className="text-4xl font-semibold leading-none tabular tracking-tight text-foreground">
              24<span className="text-2xl">%</span>
            </span>
            <span className="flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-[#92400E]">
              <TrendingDown size={12} aria-hidden="true" />
              falling
            </span>
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full glass-chip px-3 py-1.5 text-center text-[10px] font-semibold leading-tight text-[#7B3400]">
          Low — irrigate within 48h
        </span>
      </div>

      <ul className="mt-1 space-y-0">
        {nodes.map((node, i) => (
          <li key={node.label} className="relative flex items-center gap-3 py-2.5">
            {i < nodes.length - 1 && (
              <span
                className="absolute top-[34px] left-[15px] h-[18px] w-px border-l border-dashed border-foreground/15"
                aria-hidden="true"
              />
            )}
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg glass-chip text-foreground">
              <node.icon size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{node.label}</span>
            <span className="shrink-0 whitespace-nowrap rounded-full glass-chip px-2 py-0.5 font-mono text-[10px] text-foreground/80">
              {node.status}
            </span>
          </li>
        ))}
      </ul>

      {/* 30-day trend with irrigation threshold — flat fill, no gradients */}
      <div className="mt-2 border-t border-foreground/10 pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] text-foreground/65">30-DAY TREND</span>
          <span className="font-mono text-[10px] text-[#92400E]">THRESHOLD 30%</span>
        </div>
        <svg
          viewBox="0 0 260 64"
          className="mt-1.5 h-16 w-full"
          role="img"
          aria-label="Illustrative thirty-day soil moisture trend declining below the irrigation threshold"
        >
          <path
            d="M0 12 L26 15 L52 17 L78 23 L104 28 L130 27 L156 34 L182 38 L208 42 L234 46 L260 48 L260 62 L0 62 Z"
            fill="#0E7A50"
            fillOpacity="0.1"
          />
          <line x1="0" y1="32" x2="260" y2="32" stroke="#B45309" strokeOpacity="0.55" strokeDasharray="3 4" strokeWidth="1" />
          <polyline
            points="0,12 26,15 52,17 78,23 104,28 130,27 156,34 182,38 208,42 234,46 260,48"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx="260" cy="48" r="2.6" fill="var(--primary)" />
        </svg>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-foreground/10 pt-3 font-mono text-[9px] text-foreground/65">
        <span>LAST SYNC 2 MIN AGO · NODE A1</span>
        <span>ILLUSTRATIVE</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive "How Eden AI works" console                             */
/* ------------------------------------------------------------------ */

const HOW_STEPS = [
  {
    number: '01',
    icon: Radar,
    title: 'Monitor',
    body: 'Cameras and underground sensors continuously collect agricultural data.'
  },
  {
    number: '02',
    icon: Cpu,
    title: 'Analyze',
    body: 'AI identifies potential crop diseases and soil-related problems.'
  },
  {
    number: '03',
    icon: Bell,
    title: 'Alert',
    body: 'Farmers receive understandable SMS or WhatsApp notifications with actionable recommendations.'
  }
] as const;

function CameraMock() {
  return (
    <div className="flex h-full flex-col rounded-xl bg-[#0B0D0C] p-3 text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-white/60">CAM-02 · PLOT 3</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-[#7CE3A8]">
          <span className="size-1.5 rounded-full bg-[#4CD98C]" aria-hidden="true" />
          LIVE
        </span>
      </div>

      <div className="relative mt-2 h-48 overflow-hidden rounded-lg sm:h-52">
        {/* grid overlay — flat lines, no gradients */}
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <pattern id="camGrid" width="26" height="26" patternUnits="userSpaceOnUse">
              <path d="M26 0H0V26" fill="none" stroke="#FFFFFF" strokeOpacity="0.07" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="#101512" />
          <rect width="100%" height="100%" fill="url(#camGrid)" />
        </svg>

        {/* canopy blocks the model is reading */}
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true" viewBox="0 0 320 208" preserveAspectRatio="none">
          <ellipse cx="80" cy="150" rx="52" ry="34" fill="#173D27" />
          <ellipse cx="150" cy="158" rx="62" ry="38" fill="#143121" />
          <ellipse cx="238" cy="146" rx="58" ry="36" fill="#1A4230" />
        </svg>

        {/* detection box — the flagged leaf cluster */}
        <div className="absolute left-[38%] top-[38%] h-[34%] w-[30%] rounded-sm border border-[#FBBF24]">
          <span className="absolute -top-6 left-0 whitespace-nowrap rounded-sm bg-[#FBBF24] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#1F2937]">
            EARLY BLIGHT 82%
          </span>
        </div>

        {/* sweep line */}
        <div className="scan-line absolute inset-x-0 top-0 h-8 overflow-hidden" aria-hidden="true">
          <div className="h-[2px] w-full bg-[#7CE3A8]" />
          <div className="h-6 w-full bg-[#7CE3A8]/10" />
        </div>

        {/* corner brackets */}
        <span className="absolute left-2 top-2 size-4 border-l-2 border-t-2 border-white/35" aria-hidden="true" />
        <span className="absolute right-2 top-2 size-4 border-r-2 border-t-2 border-white/35" aria-hidden="true" />
        <span className="absolute bottom-2 left-2 size-4 border-b-2 border-l-2 border-white/35" aria-hidden="true" />
        <span className="absolute bottom-2 right-2 size-4 border-b-2 border-r-2 border-white/35" aria-hidden="true" />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[9px] text-white/65">
        <span>ISO 800 · f/1.8</span>
        <span>FRAME 04-2M · ILLUSTRATIVE</span>
      </div>
    </div>
  );
}

function AnalysisPanel() {
  const rows = [
    { tone: '#FBBF24', label: 'Early blight — Irish potato', detail: 'lesion spread risk within 10 days', value: 82 },
    { tone: '#4CD98C', label: 'Healthy canopy — rows A–D', detail: 'no anomalies in the last 14 days', value: 74 },
    { tone: '#FBBF24', label: 'Soil moisture at 25 cm — low', detail: 'irrigation recommended within 48 hours', value: 68 }
  ];
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">MODEL OUTPUT · ON-DEVICE</span>
        <span className="font-mono text-[10px] text-muted-foreground">120 ms</span>
      </div>
      <ul className="mt-3 flex-1 space-y-3">
        {rows.map((row) => (
          <li key={row.label} className="rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: row.tone }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{row.label}</span>
              <span className="shrink-0 font-mono text-[11px] tabular text-foreground">{row.value}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-primary" style={{ width: `${row.value}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{row.detail}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-border pt-2.5 font-mono text-[10px] text-muted-foreground">
        NO CONNECTION REQUIRED · RUNS ON THE NODE
      </p>
    </div>
  );
}

function AlertMock() {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-xl bg-[#0B0D0C] p-4">
      <div className="w-full max-w-[270px] rounded-[1.6rem] border border-white/12 bg-[#101312] p-2.5 shadow-2xl">
        <div className="flex items-center justify-between px-1.5 pb-1.5">
          <span className="font-mono text-[10px] text-white/70">14:32</span>
          <span className="flex items-center gap-1.5 text-white/60" aria-hidden="true">
            <Signal size={11} />
            <BatteryFull size={12} />
          </span>
        </div>
        <div className="rounded-2xl bg-[#161B19] px-3 py-2.5">
          <p className="font-mono text-[8px] text-[#7CE3A8]">EDEN AI · SMS</p>
          <p className="mt-1.5 text-[11px] leading-[1.45] text-[#E9EDEB]">
            <span className="font-semibold text-white">Potato plot 3:</span> early blight risk is rising. Walk the plot,
            check leaf undersides, and speak to your agronomist before the next rain.
          </p>
          <div className="mt-2.5 flex items-center justify-between border-t border-white/10 pt-2">
            <span className="font-mono text-[8px] text-white/60">14:32 · DELIVERED</span>
            <span className="font-mono text-[8px] text-white/60">REPLY 1 — AGRONOMIST</span>
          </div>
        </div>
        <p className="pt-1.5 text-center font-mono text-[8px] text-white/60">STOP TO OPT OUT</p>
      </div>
      <p className="mt-3 font-mono text-[9px] text-white/65">WORKS OVER ANY PHONE · NO INTERNET NEEDED</p>
    </div>
  );
}

function HowConsole() {
  const [step, setStep] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [autoAllowed, setAutoAllowed] = useState(true);

  // Respect reduced motion: never auto-cycle
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setAutoAllowed(!mq.matches);
    const onChange = (e: MediaQueryListEvent) => setAutoAllowed(!e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const paused = userPaused || hovered || focused || !autoAllowed;

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % HOW_STEPS.length), 6000);
    return () => window.clearInterval(id);
  }, [paused]);

  const select = (index: number) => {
    setStep(index);
    setUserPaused(true);
  };

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const count = HOW_STEPS.length;
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (step + 1) % count;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (step - 1 + count) % count;
    if (next !== null) {
      event.preventDefault();
      select(next);
    }
  };

  const panels = [<CameraMock key="cam" />, <AnalysisPanel key="brain" />, <AlertMock key="sms" />];

  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {/* Step selector */}
      <div role="tablist" aria-label="How Eden AI works" onKeyDown={onTabKeyDown} className="flex flex-col gap-3">
        {HOW_STEPS.map((item, index) => {
          const selected = index === step;
          return (
            <button
              key={item.number}
              role="tab"
              id={`how-tab-${index}`}
              aria-selected={selected}
              aria-controls={`how-panel-${index}`}
              onClick={() => select(index)}
              className={cn(
                'group flex min-h-[72px] items-start gap-4 rounded-xl border p-4 text-left transition-[border-color,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5',
                selected
                  ? 'border-primary/40 bg-accent shadow-sm'
                  : 'border-border bg-card hover:border-primary/30 hover:shadow-sm'
              )}
            >
              <span
                className={cn(
                  'font-mono text-[11px] font-semibold leading-6 transition-colors duration-300',
                  selected ? 'text-brand' : 'text-muted-foreground'
                )}
              >
                {item.number}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-base font-semibold tracking-tight text-foreground">{item.title}</span>
                  <span
                    className={cn(
                      'flex size-8 items-center justify-center rounded-lg transition-colors duration-300',
                      selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-brand'
                    )}
                  >
                    <item.icon size={16} aria-hidden="true" />
                  </span>
                </span>
                <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">{item.body}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Live device preview */}
      <div
        role="tabpanel"
        id={`how-panel-${step}`}
        aria-labelledby={`how-tab-${step}`}
        className="flex flex-col rounded-2xl border border-border bg-background p-3"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-2 pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex items-center gap-1.5" aria-hidden="true">
              {HOW_STEPS.map((item, index) => (
                <span
                  key={item.number}
                  className={cn(
                    'h-1 w-8 rounded-full transition-colors duration-300',
                    index === step ? 'bg-primary' : 'bg-border'
                  )}
                />
              ))}
            </span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">FIELD PREVIEW</span>
          </div>
          <button
            type="button"
            onClick={() => setUserPaused((v) => !v)}
            aria-pressed={userPaused}
            aria-label={userPaused ? 'Resume automatic cycling' : 'Pause automatic cycling'}
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {userPaused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
          </button>
        </div>
        <div key={step} className="card-enter min-h-0 flex-1 pt-3">
          {panels[step]}
        </div>
        <p className="px-2 pb-1 pt-2.5 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          Illustrative example — not a live deployment
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Landing page                                                        */
/* ------------------------------------------------------------------ */

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Close the mobile menu when the viewport grows past the breakpoint
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const close = () => setMenuOpen(false);
    mq.addEventListener('change', close);
    return () => mq.removeEventListener('change', close);
  }, []);

  // Header elevation once the page has moved
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrolled(window.scrollY > 24));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* ---------------------------------------------------------- */}
      {/* Navigation                                                   */}
      {/* ---------------------------------------------------------- */}
      <header
        className={cn(
          'sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-lg transition-shadow duration-300',
          scrolled && 'shadow-[0_8px_28px_-14px_rgba(18,22,20,0.35)]'
        )}
      >
        <ScrollProgressBar />
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          <a href="#main" className="flex items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo size={30} />
          </a>

          <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-1 py-1.5 text-sm text-muted-foreground transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden shrink-0 md:block">
            <Link
              to="/dashboard"
              className={cn(buttonVariants({}), 'h-11 gap-2 px-5 focus-visible:ring-2 focus-visible:ring-ring')}
            >
              Explore Our Technology
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
          >
            {menuOpen ? <XClose size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {menuOpen && (
            <motion.div
              key="mobile-menu"
              id="mobile-menu"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: EASE_STANDARD }}
              className="overflow-hidden border-t border-border md:hidden"
            >
              <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3" aria-label="Mobile">
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-lg px-3 py-3 text-sm text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {link.label}
                  </a>
                ))}
                <Link
                  to="/dashboard"
                  onClick={() => setMenuOpen(false)}
                  className={cn(buttonVariants({}), 'mt-2 h-11 w-full gap-2 focus-visible:ring-2 focus-visible:ring-ring')}
                >
                  Explore Our Technology
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main id="main">
        {/* ---------------------------------------------------------- */}
        {/* Hero                                                        */}
        {/* ---------------------------------------------------------- */}
        <section className="relative isolate overflow-hidden">
          <img
            src={HERO_PHOTO}
            alt="A Nigerian farmer examining crops in an open field"
            className="hero-photo absolute inset-0 size-full object-cover object-[62%_center]"
            width={1920}
            height={1280}
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-black/55" aria-hidden="true" />

          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-14 pt-14 md:px-6 md:pb-16 md:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14 lg:pb-20 lg:pt-24">
            <div className="max-w-xl">
              <span className="hero-rise inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/35 px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.08em] text-white backdrop-blur-sm">
                <span className="relative flex size-1.5">
                  <span className="live-ring absolute inline-flex h-full w-full rounded-full bg-[#A3E635]" aria-hidden="true" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-[#A3E635]" />
                </span>
                Grow Smarter. Farm Better.
              </span>

              <h1
                className="hero-rise mt-5 text-balance text-[clamp(2.6rem,8vw,4.05rem)] font-semibold leading-[1.0] tracking-[-0.033em] text-white"
                style={{ animationDelay: '80ms' }}
              >
                Smarter Farming.
                <br />
                Stronger Harvests.
                <br />
                A Better Future.
              </h1>

              <p
                className="hero-rise mt-5 max-w-lg text-[15px] leading-relaxed text-white/90 sm:text-base"
                style={{ animationDelay: '160ms' }}
              >
                Eden AI brings intelligent agricultural monitoring to rural farmers through AI-powered cameras and
                smart soil sensors, helping detect crop diseases and soil problems before they become costly losses.
              </p>

              <div className="hero-rise mt-7 flex flex-wrap items-center gap-3" style={{ animationDelay: '240ms' }}>
                <Link
                  to="/dashboard"
                  className={cn(
                    buttonVariants({}),
                    'h-11 gap-2 px-5 text-[15px] transition-[transform,background-color,color] duration-200 focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  Explore Our Technology
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <a
                  href="#mission"
                  className="inline-flex h-11 select-none items-center justify-center gap-1.5 rounded-lg border border-white/40 px-5 text-[15px] font-medium text-white transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:translate-y-px"
                >
                  Our Mission
                </a>
              </div>

              <p className="hero-rise mt-6 flex items-center gap-2 text-xs font-medium text-white/75" style={{ animationDelay: '300ms' }}>
                <MapPin size={13} aria-hidden="true" className="shrink-0" />
                Starting in Plateau State, Nigeria
              </p>
            </div>

            <div className="hero-rise lg:justify-self-end" style={{ animationDelay: '340ms' }}>
              <FieldNodePanel />
            </div>
          </div>

          {/* Crops and field notes — pauses on hover, frozen with reduced motion */}
          <div className="relative border-t border-white/15 bg-black/40 py-2.5 backdrop-blur-sm" aria-hidden="true">
            <div className="overflow-hidden">
              <div className="marquee-track flex w-max items-center gap-7">
                {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-7 whitespace-nowrap font-mono text-[11px] text-white/70"
                  >
                    {item}
                    <span className="size-1 rounded-full bg-white/30" aria-hidden="true" />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* The Problem                                                 */}
        {/* ---------------------------------------------------------- */}
        <section id="problem" className="scroll-mt-20 bg-background py-16 md:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 md:px-6 lg:grid-cols-2 lg:items-center lg:gap-16">
            <Reveal>
              <SectionHeader eyebrow="The problem" title="Farming shouldn’t have to be a gamble">
                <p>
                  Across rural Nigeria, farmers face the same hard realities — and every one of them costs time, yield,
                  and income.
                </p>
              </SectionHeader>

              <ul className="mt-8 space-y-4">
                {PROBLEMS.map((item) => (
                  <li
                    key={item.title}
                    className="flex gap-3.5 rounded-xl p-2 transition-colors duration-200 hover:bg-muted/60"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                      <item.icon size={16} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{item.title}</span>
                      <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{item.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={0.1}>
              <figure>
                <div className="overflow-hidden rounded-2xl border border-border">
                  <img
                    src={PROBLEM_PHOTO}
                    alt="An African farmer inspecting crops in the field"
                    className="aspect-[4/3] w-full object-cover"
                    width={900}
                    height={675}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <figcaption className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Field inspection — Plateau State
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Our Solution (+ mission)                                    */}
        {/* ---------------------------------------------------------- */}
        <section id="solution" className="scroll-mt-20 border-t border-border bg-card py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <Reveal>
              <SectionHeader eyebrow="Our solution" title="One intelligent system, built for the field">
                <p id="mission" className="scroll-mt-20">
                  <span className="font-medium text-foreground">Our mission</span> is to put intelligent agricultural
                  monitoring within reach of every rural farmer — starting where the need is greatest, and building
                  technology that fits the realities of the land.
                </p>
              </SectionHeader>
            </Reveal>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SOLUTION_CARDS.map((card) => (
                <Reveal key={card.title} delay={0.05}>
                  <div className="group h-full rounded-2xl border border-border bg-background p-5 transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                      <card.icon size={18} aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-sm font-semibold tracking-tight text-foreground">{card.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal className="mt-6" delay={0.1}>
              <div className="grid overflow-hidden rounded-2xl border border-border bg-background md:grid-cols-[2fr_3fr] md:items-stretch">
                <figure className="relative min-h-56">
                  <img
                    src={SENSOR_PHOTO}
                    alt="An environmental sensor monitoring conditions inside a greenhouse"
                    className="absolute inset-0 h-full w-full object-cover"
                    width={900}
                    height={675}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white backdrop-blur-sm">
                    Sensor under test
                  </span>
                </figure>
                <div className="p-6 md:p-8">
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-brand">Designed for rural reality</p>
                  <h3 className="mt-2.5 text-balance text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">
                    Technology that works where the internet doesn’t
                  </h3>
                  <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                    Eden AI’s monitoring system is built around low-power sensors, on-device intelligence, and local
                    communication networks. Data is collected in the field, analysed close to the source, and delivered
                    to farmers as simple alerts — without waiting on a constant internet connection.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {['Offline-first', 'Low-power sensors', 'On-device AI', 'Solar-ready'].map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* How it works — interactive console                            */}
        {/* ---------------------------------------------------------- */}
        <section id="how" className="scroll-mt-20 border-t border-border bg-background py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <Reveal>
              <SectionHeader eyebrow="How it works" title="From the field to the farmer’s phone">
                <p>Select a step to see the system at work.</p>
              </SectionHeader>
            </Reveal>
            <div className="mt-10">
              <HowConsole />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Our crops & initial focus                                    */}
        {/* ---------------------------------------------------------- */}
        <section id="crops" className="scroll-mt-20 border-t border-border bg-card py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <Reveal>
              <SectionHeader eyebrow="Our crops & initial focus" title="Starting in Plateau State, Nigeria">
                <p>
                  Eden AI begins where agricultural potential and need meet: the communities of Plateau State. Three
                  crops sit at the centre of the initial deployment — each highly sensitive to the soil and disease
                  pressures the system monitors, and each vital to the farmers who grow them.
                </p>
              </SectionHeader>
            </Reveal>

            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {CROPS.map((crop) => (
                <Reveal key={crop.name} delay={0.05}>
                  <article className="group h-full overflow-hidden rounded-2xl border border-border bg-background transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg">
                    <div className="relative overflow-hidden">
                      <img
                        src={crop.photo}
                        alt={crop.alt}
                        className="aspect-[4/3] w-full object-cover transition-transform duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.06]"
                        width={800}
                        height={600}
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white backdrop-blur-sm">
                        {crop.note}
                      </span>
                    </div>
                    <div className="p-5">
                      <h3 className="text-base font-semibold tracking-tight text-foreground">{crop.name}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{crop.body}</p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Affordable technology (Sensor-as-a-Service)                  */}
        {/* ---------------------------------------------------------- */}
        <section id="pricing" className="scroll-mt-20 border-t border-border bg-background py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <Reveal>
              <SectionHeader eyebrow="Affordable technology for everyone" title="Sensor-as-a-Service">
                <p className="text-lg font-medium !leading-snug text-foreground sm:text-xl">
                  &ldquo;Farmers shouldn&rsquo;t have to purchase expensive technology to benefit from innovation.&rdquo;
                </p>
                <p className="mt-3">
                  Eden AI leases its monitoring equipment to farmers for an affordable recurring fee, reducing upfront
                  costs and making intelligent farming accessible to underserved communities.
                </p>
              </SectionHeader>
            </Reveal>

            <div className="mt-12 grid gap-6 md:grid-cols-2">
              <Reveal>
                <div className="h-full rounded-2xl border border-border bg-card p-6 transition-shadow duration-300 hover:shadow-md sm:p-7">
                  <h3 className="text-sm font-semibold text-muted-foreground">The old way</h3>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Buy the technology outright
                  </p>
                  <ul className="mt-6 space-y-3.5">
                    {[
                      'High upfront cost before a single harvest',
                      'Equipment risk sits entirely with the farmer',
                      'Hardware quickly becomes outdated',
                      'Only the largest farms can participate'
                    ].map((item) => (
                      <li key={item} className="flex gap-2.5 text-sm text-muted-foreground">
                        <XIcon size={15} className="mt-0.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>

              <Reveal delay={0.08}>
                <div className="relative h-full rounded-2xl border border-primary/40 bg-accent p-6 transition-shadow duration-300 hover:shadow-lg sm:p-7">
                  <span className="absolute -top-3 right-5 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">
                    Low upfront cost
                  </span>
                  <h3 className="text-sm font-semibold text-accent-foreground">The Eden AI way</h3>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-foreground/75">
                    Lease what you need, when you need it
                  </p>
                  <ul className="mt-6 space-y-3.5">
                    {[
                      'An affordable recurring fee instead of a large investment',
                      'Equipment is maintained and upgraded by Eden AI',
                      'Start with one field and grow from there',
                      'Built for smallholders and underserved communities'
                    ].map((item) => (
                      <li key={item} className="flex gap-2.5 text-sm text-accent-foreground">
                        <Check size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>

            <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Pricing is developed with partners — <a href="#contact" className="rounded-sm underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">talk to us</a>
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Our impact                                                   */}
        {/* ---------------------------------------------------------- */}
        <section id="impact" className="scroll-mt-20 border-t border-border bg-card py-16 md:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 md:px-6 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16">
            <Reveal>
              <figure>
                <div className="overflow-hidden rounded-2xl border border-border">
                  <img
                    src={IMPACT_PHOTO}
                    alt="A smiling female farmer standing in a Nigerian field"
                    className="aspect-[4/3] w-full object-cover"
                    width={900}
                    height={675}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <figcaption className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Women in agriculture — Plateau State
                </figcaption>
              </figure>
            </Reveal>

            <Reveal delay={0.08}>
              <SectionHeader eyebrow="Our impact" title="Technology that includes everyone">
                <p>Eden AI measures success by who it reaches — and by the decisions it helps farmers make.</p>
              </SectionHeader>

              <ul className="mt-8 grid gap-4 sm:grid-cols-2">
                {IMPACTS.map((item) => (
                  <li
                    key={item.body}
                    className="flex gap-3 rounded-2xl border border-border bg-background p-4 transition-[border-color,box-shadow] duration-300 hover:border-primary/30 hover:shadow-md"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <item.icon size={16} aria-hidden="true" />
                    </span>
                    <span className="text-sm leading-relaxed text-muted-foreground">{item.body}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Our vision — network constellation over Plateau             */}
        {/* ---------------------------------------------------------- */}
        <section id="vision" className="scroll-mt-20 border-t border-primary-foreground/10 bg-primary py-16 text-primary-foreground md:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 md:px-6 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <SectionHeader onDark eyebrow="Our vision" title="Intelligent farming, accessible across Nigeria">
                <p>
                  Eden AI begins with Plateau State and expands into other YAI-supported states — with the ambition of
                  making intelligent farming accessible to every community that wants it.
                </p>
              </SectionHeader>
            </Reveal>

            <Reveal delay={0.08} className="justify-self-center">
              <svg
                viewBox="0 0 400 300"
                className="w-full max-w-md"
                role="img"
                aria-label="A connected constellation of farm monitoring nodes, representing communities across Nigeria sharing one network"
              >
                {[
                  [40, 216, 92, 116],
                  [40, 216, 148, 192],
                  [92, 116, 188, 66],
                  [92, 116, 148, 192],
                  [148, 192, 230, 148],
                  [148, 192, 188, 66],
                  [188, 66, 298, 88],
                  [188, 66, 230, 148],
                  [230, 148, 298, 88],
                  [230, 148, 328, 208],
                  [230, 148, 366, 150],
                  [298, 88, 366, 150],
                  [328, 208, 366, 150],
                  [40, 216, 118, 262],
                  [148, 192, 118, 262],
                  [118, 262, 254, 258],
                  [328, 208, 254, 258],
                  [254, 258, 366, 150]
                ].map(([x1, y1, x2, y2], i) => (
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="1.25" />
                ))}
                {[
                  { cx: 40, cy: 216, r: 4.5, hot: false },
                  { cx: 92, cy: 116, r: 4, hot: false },
                  { cx: 148, cy: 192, r: 6, hot: true },
                  { cx: 188, cy: 66, r: 4, hot: false },
                  { cx: 230, cy: 148, r: 7.5, hot: true },
                  { cx: 298, cy: 88, r: 4.5, hot: false },
                  { cx: 328, cy: 208, r: 4.5, hot: false },
                  { cx: 366, cy: 150, r: 5.5, hot: true },
                  { cx: 118, cy: 262, r: 4, hot: false },
                  { cx: 254, cy: 258, r: 4, hot: false }
                ].map((node, i) => (
                  <circle
                    key={i}
                    cx={node.cx}
                    cy={node.cy}
                    r={node.r}
                    fill={node.hot ? '#A3E635' : '#E6F2EB'}
                    fillOpacity={node.hot ? 1 : 0.9}
                  />
                ))}
              </svg>
              <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[#E6F2EB]">
                Plateau State — and everywhere YAI grows
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Call to action                                               */}
        {/* ---------------------------------------------------------- */}
        <section id="cta" className="scroll-mt-20 border-t border-white/10 bg-foreground py-16 text-background md:py-24">
          <div className="mx-auto max-w-3xl px-4 text-center md:px-6">
            <Reveal>
              <div className="flex justify-center">
                <Logo variant="light" size={52} />
              </div>
              <h2 className="mt-7 text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.025em] text-[#F6F7F6] sm:text-4xl lg:text-5xl">
                The Future of Farming Should Be Accessible to Everyone.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-balance text-sm leading-relaxed text-[#F6F7F6]/80 sm:text-base">
                Join us in building a future where every farmer, regardless of location or resources, can make
                smarter agricultural decisions.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <a
                  href="#contact"
                  className="inline-flex h-11 select-none items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-[15px] font-medium text-primary-foreground transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A3E635] active:translate-y-px"
                >
                  Partner With Eden AI
                </a>
                <a
                  href="mailto:hello@edens-ai.com"
                  className="inline-flex h-11 select-none items-center justify-center gap-1.5 rounded-lg border border-white/25 px-5 text-[15px] font-medium text-[#F6F7F6] transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-white/50 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A3E635] active:translate-y-px"
                >
                  Get In Touch
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ---------------------------------------------------------- */}
      {/* Footer                                                       */}
      {/* ---------------------------------------------------------- */}
      <footer id="contact" className="scroll-mt-20 border-t border-border bg-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-2 md:px-6 lg:grid-cols-4">
          <div>
            <Logo size={34} />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Eden AI brings intelligent agricultural monitoring to rural farmers through AI-powered cameras and smart
              soil sensors.
            </p>
          </div>

          <nav aria-label="Explore">
            <h2 className="text-sm font-semibold text-foreground">Explore</h2>
            <ul className="mt-4 space-y-2.5">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="text-sm font-semibold text-foreground">Technology</h2>
            <ul className="mt-4 space-y-2.5">
              {SOLUTION_CARDS.map((card) => (
                <li key={card.title}>
                  <a
                    href="#solution"
                    className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {card.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground">Contact</h2>
            {/* Placeholder contact details — replace with live information before launch. */}
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2.5">
                <Globe size={15} className="shrink-0 text-brand" aria-hidden="true" />
                <a
                  href="https://www.edens-ai.com"
                  className="transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  www.edens-ai.com
                </a>
              </li>
              <li className="flex items-center gap-2.5">
                <Mail size={15} className="shrink-0 text-brand" aria-hidden="true" />
                <a
                  href="mailto:hello@edens-ai.com"
                  className="transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  hello@edens-ai.com
                </a>
              </li>
              <li className="flex items-center gap-2.5">
                <MapPin size={15} className="shrink-0 text-brand" aria-hidden="true" />
                Plateau State, Nigeria
              </li>
            </ul>
            <div className="mt-5 flex gap-2">
              {[
                { icon: Twitter, label: 'Eden AI on X — @edensai' },
                { icon: Youtube, label: 'Eden AI on YouTube — @edensai' },
                { icon: Linkedin, label: 'Eden AI on LinkedIn — @edensai' }
              ].map((social) => (
                <a
                  key={social.label}
                  href="#contact"
                  aria-label={social.label}
                  className="flex size-11 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
                >
                  <social.icon size={17} aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-6">
            <span>
              &copy; {new Date().getFullYear()} Eden AI. All rights reserved. &mdash; Smarter farming, stronger harvests.
            </span>
            <span className="font-mono uppercase tracking-[0.18em]">A RA Innovation</span>
          </div>
        </div>
      </footer>

      <BackToTop />
    </div>
  );
}
