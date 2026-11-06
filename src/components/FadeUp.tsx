import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { EASE_STANDARD, DUR_ENTER } from '../lib/motion';

interface FadeUpProps {
  children: ReactNode;
  className?: string;
  /** Extra delay in seconds — use sparingly, never above 0.08s. */
  delay?: number;
  /** Rise distance in pixels — keep between 4 and 16. */
  y?: number;
}

/**
 * Reusable fade-up reveal for sections and panels. Opacity + transform only;
 * reduced-motion users get the fade without the rise via MotionConfig.
 */
export function FadeUp({ children, className, delay = 0, y = 12 }: FadeUpProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR_ENTER, delay, ease: EASE_STANDARD }}
    >
      {children}
    </motion.div>
  );
}
