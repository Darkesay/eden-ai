import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  Leaf,
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
  Mail,
  MapPin,
  Phone,
  Twitter,
  Linkedin,
  Instagram,
  Check,
  X as XIcon
} from 'lucide-react';
import { buttonVariants } from '../components/ui/button';
import { cn } from '../lib/utils';
import { EASE_STANDARD } from '../lib/motion';

/**
 * Eden AI landing page — the default entry point of the app (/).
 * Built on the dashboard design tokens (deep forest green, warm white,
 * accent tints) with the shared motion curve. Photography: Pexels,
 * Nigerian/African farmers, lazy-loaded and width-constrained.
 */

/* Verified Pexels CDN URLs (all 200 image/jpeg). */
const photo = (id: string, w: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;

const HERO_PHOTO = photo('34411658', 1920); // Nigerian farmer examining crops in an open field
const PROBLEM_PHOTO = photo('34411687', 900); // African farmer inspecting crops
const SENSOR_PHOTO = photo('16905006', 900); // Environmental sensor in a greenhouse
const FIELD_PHOTO = photo('36937772', 1200); // Farmer inspecting plants in a Nigerian greenhouse
const POTATO_PHOTO = photo('31908568', 800); // Lush green potato field
const TOMATO_PHOTO = photo('34705725', 800); // African farmers harvesting tomatoes in Nigeria
const MAIZE_PHOTO = photo('39234869', 800); // Lush cornfield
const IMPACT_PHOTO = photo('34705723', 900); // Smiling female farmer in a Nigerian field
const VISION_PHOTO = photo('35246303', 1920); // African farmer working a field

const NAV_LINKS = [
  { href: '#solution', label: 'Technology' },
  { href: '#mission', label: 'Our Mission' },
  { href: '#crops', label: 'Our Crops' },
  { href: '#impact', label: 'Our Impact' },
  { href: '#contact', label: 'Contact' }
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

const STEPS = [
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
];

const CROPS = [
  {
    photo: POTATO_PHOTO,
    alt: 'Lush green Irish potato field',
    name: 'Irish Potatoes',
    body: 'A flagship crop of the Plateau highlands, sensitive to late blight and soil moisture stress — exactly the pressures Eden AI detects early.'
  },
  {
    photo: TOMATO_PHOTO,
    alt: 'African farmers harvesting fresh tomatoes in Nigeria',
    name: 'Tomatoes',
    body: 'High-value and perishable. A few days of undetected disease can erase an entire season of profit.'
  },
  {
    photo: MAIZE_PHOTO,
    alt: 'Lush green maize field under a clear sky',
    name: 'Maize',
    body: 'A staple across Nigeria. Protecting maize yields protects household food security and farm income.'
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
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold text-brand">{children}</p>;
}

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

/** Stylised Eden AI field node — the elegant "smart farming" visual. */
function FieldNodePanel() {
  const nodes = [
    { icon: Camera, label: 'AI crop camera', status: 'Watching' },
    { icon: Cpu, label: 'On-device AI', status: 'Learning' },
    { icon: Radio, label: 'Local mesh network', status: 'Connected' },
    { icon: MessageSquare, label: 'SMS · WhatsApp alerts', status: 'Delivering' }
  ];
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Leaf size={15} aria-hidden="true" />
          </span>
          Eden AI field node
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-success">
          <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
          Live
        </span>
      </div>
      <ul className="space-y-0">
        {nodes.map((node, i) => (
          <li key={node.label} className="relative flex items-center gap-3 py-2.5">
            {i < nodes.length - 1 && (
              <span
                className="absolute top-[34px] left-[13px] h-[18px] w-px border-l border-dashed border-border"
                aria-hidden="true"
              />
            )}
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-brand">
              <node.icon size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{node.label}</span>
            </span>
            <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {node.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Landing page                                                        */
/* ------------------------------------------------------------------ */

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu when the viewport grows past the breakpoint
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const close = () => setMenuOpen(false);
    mq.addEventListener('change', close);
    return () => mq.removeEventListener('change', close);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ---------------------------------------------------------- */}
      {/* Navigation                                                   */}
      {/* ---------------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          <a href="#top" className="flex shrink-0 items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Leaf size={17} aria-hidden="true" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Eden AI</span>
          </a>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden shrink-0 md:block">
            <Link to="/dashboard" className={cn(buttonVariants({}), 'gap-2')}>
              Explore Our Technology
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <XClose size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {menuOpen && (
            <motion.div
              key="mobile-menu"
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
                    className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
                  >
                    {link.label}
                  </a>
                ))}
                <Link
                  to="/dashboard"
                  onClick={() => setMenuOpen(false)}
                  className={cn(buttonVariants({}), 'mt-2 w-full gap-2')}
                >
                  Explore Our Technology
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main id="top">
        {/* ---------------------------------------------------------- */}
        {/* Hero                                                        */}
        {/* ---------------------------------------------------------- */}
        <section className="relative isolate overflow-hidden">
          <img
            src={HERO_PHOTO}
            alt="A Nigerian farmer examining crops in an open field"
            className="hero-photo absolute inset-0 size-full object-cover object-center"
            width={1920}
            height={1280}
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-black/55" aria-hidden="true" />

          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 md:px-6 md:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14 lg:py-28">
            <div className="max-w-xl">
              <span className="hero-rise inline-flex items-center gap-2 rounded-full border border-primary-foreground/30 bg-black/30 px-3 py-1 text-[11px] font-medium text-primary-foreground">
                <span className="size-1.5 rounded-full bg-primary-foreground" aria-hidden="true" />
                Intelligent farming for rural communities
              </span>

              <h1
                className="hero-rise mt-5 text-4xl font-semibold leading-[1.08] tracking-tight text-primary-foreground sm:text-5xl lg:text-6xl"
                style={{ animationDelay: '80ms' }}
              >
                Smarter Farming.
                <br />
                Stronger Harvests.
                <br />
                A Better Future.
              </h1>

              <p
                className="hero-rise mt-5 max-w-lg text-sm leading-relaxed text-primary-foreground/90 sm:text-base"
                style={{ animationDelay: '160ms' }}
              >
                Eden AI brings intelligent agricultural monitoring to rural farmers through AI-powered cameras and
                smart soil sensors, helping detect crop diseases and soil problems before they become costly losses.
              </p>

              <div className="hero-rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: '240ms' }}>
                <Link
                  to="/dashboard"
                  className={cn(buttonVariants({}), 'h-11 gap-2 px-5 text-[15px]')}
                >
                  Explore Our Technology
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <a
                  href="#mission"
                  className={cn(
                    'inline-flex h-11 select-none items-center justify-center gap-1.5 rounded-lg border border-primary-foreground/40 px-5 text-[15px] font-medium text-primary-foreground transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none hover:bg-primary-foreground/10 active:translate-y-px'
                  )}
                >
                  Our Mission
                </a>
              </div>
            </div>

            <div className="hero-rise lg:justify-self-end" style={{ animationDelay: '320ms' }}>
              <FieldNodePanel />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* The Problem                                                 */}
        {/* ---------------------------------------------------------- */}
        <section id="problem" className="scroll-mt-20 bg-background py-16 md:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 md:px-6 lg:grid-cols-2 lg:items-center lg:gap-16">
            <Reveal>
              <Eyebrow>The problem</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Farming shouldn&apos;t have to be a gamble
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
                Across rural Nigeria, farmers face the same hard realities — and every one of them costs time, yield,
                and income.
              </p>

              <ul className="mt-8 space-y-5">
                {PROBLEMS.map((item) => (
                  <li key={item.title} className="flex gap-3.5">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                      <item.icon size={16} aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-foreground">{item.title}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{item.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={0.1}>
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
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Our Solution (+ mission)                                    */}
        {/* ---------------------------------------------------------- */}
        <section id="solution" className="scroll-mt-20 border-t border-border bg-card py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <Reveal className="max-w-2xl">
              <Eyebrow>Our solution</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                One intelligent system, built for the field
              </h2>
              <p id="mission" className="scroll-mt-20 mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                <span className="font-medium text-foreground">Our mission</span> is to put intelligent agricultural
                monitoring within reach of every rural farmer — starting where the need is greatest, and building
                technology that fits the realities of the land.
              </p>
            </Reveal>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SOLUTION_CARDS.map((card, i) => (
                <Reveal key={card.title} delay={i * 0.05}>
                  <div className="h-full rounded-xl border border-border bg-background p-5 transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-md">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <card.icon size={17} aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-sm font-semibold text-foreground">{card.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal className="mt-14">
              <div className="grid gap-8 overflow-hidden rounded-2xl border border-border bg-background p-6 md:grid-cols-[1fr_1.1fr] md:items-center md:gap-10 md:p-8">
                <div className="overflow-hidden rounded-xl border border-border">
                  <img
                    src={SENSOR_PHOTO}
                    alt="An environmental sensor monitoring conditions inside a greenhouse"
                    className="aspect-[4/3] w-full object-cover"
                    width={900}
                    height={675}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div>
                  <Eyebrow>Designed for rural reality</Eyebrow>
                  <h3 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">
                    Technology that works where the internet doesn&apos;t
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                    Eden AI&apos;s monitoring system is built around low-power sensors, on-device intelligence, and
                    local communication networks. Data is collected in the field, analysed close to the source, and
                    delivered to farmers as simple alerts — without waiting on a constant internet connection.
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
        {/* How it works                                                 */}
        {/* ---------------------------------------------------------- */}
        <section id="how" className="scroll-mt-20 border-t border-border bg-background py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <Reveal className="max-w-2xl">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                From the field to the farmer&apos;s phone
              </h2>
            </Reveal>

            <div className="relative mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <Reveal key={step.number} delay={i * 0.08}>
                  <div className="relative h-full rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold tracking-widest text-brand">{step.number}</span>
                      <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                        <step.icon size={17} aria-hidden="true" />
                      </span>
                    </div>
                    <h3 className="mt-6 text-lg font-semibold tracking-tight">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Our crops & initial focus                                    */}
        {/* ---------------------------------------------------------- */}
        <section id="crops" className="scroll-mt-20 border-t border-border bg-card py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <Reveal className="max-w-2xl">
              <Eyebrow>Our crops &amp; initial focus</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Starting in Plateau State, Nigeria
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                Eden AI begins where agricultural potential and need meet: the communities of Plateau State. Three
                crops sit at the centre of the initial deployment — each highly sensitive to the soil and disease
                pressures the system monitors, and each vital to the farmers who grow them.
              </p>
            </Reveal>

            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {CROPS.map((crop, i) => (
                <Reveal key={crop.name} delay={i * 0.06}>
                  <article className="h-full overflow-hidden rounded-xl border border-border bg-background transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-md">
                    <img
                      src={crop.photo}
                      alt={crop.alt}
                      className="aspect-[4/3] w-full object-cover"
                      width={800}
                      height={600}
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="p-5">
                      <h3 className="text-base font-semibold tracking-tight">{crop.name}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{crop.body}</p>
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
            <Reveal className="max-w-2xl">
              <Eyebrow>Affordable technology for everyone</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Sensor-as-a-Service</h2>
              <p className="mt-4 text-lg font-medium italic leading-relaxed text-foreground sm:text-xl">
                &ldquo;Farmers shouldn&apos;t have to purchase expensive technology to benefit from innovation.&rdquo;
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                Eden AI leases its monitoring equipment to farmers for an affordable recurring fee, reducing upfront
                costs and making intelligent farming accessible to underserved communities.
              </p>
            </Reveal>

            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <Reveal>
                <div className="h-full rounded-2xl border border-border bg-card p-6">
                  <h3 className="text-sm font-semibold text-muted-foreground">The old way</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">Buy the technology outright</p>
                  <ul className="mt-5 space-y-3">
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
                <div className="h-full rounded-2xl border border-primary/30 bg-accent p-6">
                  <h3 className="text-sm font-semibold text-accent-foreground">The Eden AI way</h3>
                  <p className="mt-1 text-[11px] text-accent-foreground/80">Lease what you need, when you need it</p>
                  <ul className="mt-5 space-y-3">
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

            <p className="mt-6 text-[11px] text-muted-foreground">
              Pricing is developed with partners and tailored to each community — get in touch to learn more.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Our impact                                                   */}
        {/* ---------------------------------------------------------- */}
        <section id="impact" className="scroll-mt-20 border-t border-border bg-card py-16 md:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 md:px-6 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16">
            <Reveal>
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
            </Reveal>

            <Reveal delay={0.08}>
              <Eyebrow>Our impact</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Technology that includes everyone
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
                Eden AI measures success by who it reaches — and by the decisions it helps farmers make.
              </p>

              <ul className="mt-8 grid gap-4 sm:grid-cols-2">
                {IMPACTS.map((item) => (
                  <li key={item.body} className="flex gap-3 rounded-xl border border-border bg-background p-4">
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
        {/* Our vision                                                   */}
        {/* ---------------------------------------------------------- */}
        <section id="vision" className="relative isolate scroll-mt-20 overflow-hidden">
          <img
            src={VISION_PHOTO}
            alt="An African farmer working in a green field"
            className="absolute inset-0 size-full object-cover object-center"
            width={1920}
            height={1280}
            loading="lazy"
            decoding="async"
          />
          <div className="absolute inset-0 bg-black/60" aria-hidden="true" />

          <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal className="max-w-2xl">
              <Eyebrow>Our vision</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-primary-foreground sm:text-4xl lg:text-5xl">
                Intelligent farming, accessible across Nigeria
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-primary-foreground/90 sm:text-base">
                Eden AI begins with Plateau State and expands into other YAI-supported states — with the ambition of
                making intelligent farming accessible to every community that wants it.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Call to action                                               */}
        {/* ---------------------------------------------------------- */}
        <section id="cta" className="scroll-mt-20 bg-primary py-16 text-primary-foreground md:py-24">
          <div className="mx-auto max-w-3xl px-4 text-center md:px-6">
            <Reveal>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
                The Future of Farming Should Be Accessible to Everyone.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-primary-foreground/90 sm:text-base">
                Join us in building a future where every farmer, regardless of location or resources, can make
                smarter agricultural decisions.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <a
                  href="#contact"
                  className="inline-flex h-11 select-none items-center justify-center gap-1.5 rounded-lg bg-primary-foreground px-5 text-[15px] font-medium text-primary transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none hover:bg-primary-foreground/90 active:translate-y-px"
                >
                  Partner With Eden AI
                </a>
                <a
                  href="#contact"
                  className="inline-flex h-11 select-none items-center justify-center gap-1.5 rounded-lg border border-primary-foreground/40 px-5 text-[15px] font-medium text-primary-foreground transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none hover:bg-primary-foreground/10 active:translate-y-px"
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
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Leaf size={17} aria-hidden="true" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">Eden AI</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Eden AI brings intelligent agricultural monitoring to rural farmers through AI-powered cameras and
              smart soil sensors.
            </p>
          </div>

          <nav aria-label="Explore">
            <h3 className="text-sm font-semibold text-foreground">Explore</h3>
            <ul className="mt-4 space-y-2.5">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Technology</h3>
            <ul className="mt-4 space-y-2.5">
              {SOLUTION_CARDS.map((card) => (
                <li key={card.title}>
                  <a
                    href="#solution"
                    className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
                  >
                    {card.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Contact</h3>
            {/* Placeholder contact details — replace with live information before launch. */}
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2.5">
                <MapPin size={15} className="shrink-0 text-brand" aria-hidden="true" />
                Plateau State, Nigeria
              </li>
              <li className="flex items-center gap-2.5">
                <Mail size={15} className="shrink-0 text-brand" aria-hidden="true" />
                <a href="mailto:hello@edenai.ng" className="transition-colors hover:text-foreground">
                  hello@edenai.ng
                </a>
              </li>
              <li className="flex items-center gap-2.5">
                <Phone size={15} className="shrink-0 text-brand" aria-hidden="true" />
                <span className="tabular">+234 (0) 800 000 0000</span>
              </li>
            </ul>
            <div className="mt-5 flex gap-2">
              {[
                { icon: Twitter, label: 'X (Twitter)' },
                { icon: Linkedin, label: 'LinkedIn' },
                { icon: Instagram, label: 'Instagram' }
              ].map((social) => (
                <a
                  key={social.label}
                  href="#contact"
                  aria-label={`Eden AI on ${social.label} (placeholder)`}
                  className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-muted hover:text-foreground active:translate-y-px"
                >
                  <social.icon size={16} />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-6">
            <span>&copy; {new Date().getFullYear()} Eden AI. All rights reserved.</span>
            <span>Intelligent agricultural monitoring for rural farmers.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
