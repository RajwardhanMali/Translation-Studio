'use client'

import { MotionConfig, motion, type HTMLMotionProps, type Variants } from 'framer-motion'
import { cn } from '@/lib/utils'

const ease: [number, number, number, number] = [0.22, 1, 0.36, 1]

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.04,
    },
  },
}

export const fadeUpVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 28,
    scale: 0.985,
    filter: 'blur(10px)',
  },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: {
      duration: 0.7,
      ease,
    },
  },
}

export const softFadeVariants: Variants = {
  hidden: {
    opacity: 0,
  },
  show: {
    opacity: 1,
    transition: {
      duration: 0.55,
      ease,
    },
  },
}

export function Reveal({
  className,
  delay = 0,
  once = true,
  amount = 0.2,
  ...props
}: HTMLMotionProps<'div'> & {
  delay?: number
  once?: boolean
  amount?: number
}) {
  return (
    <motion.div
      className={className}
      variants={fadeUpVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      transition={{ duration: 0.7, delay, ease }}
      {...props}
    />
  )
}

export function FadeIn({
  className,
  delay = 0,
  once = true,
  amount = 0.2,
  ...props
}: HTMLMotionProps<'div'> & {
  delay?: number
  once?: boolean
  amount?: number
}) {
  return (
    <motion.div
      className={className}
      variants={softFadeVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      transition={{ duration: 0.55, delay, ease }}
      {...props}
    />
  )
}

export function FloatLayer({ className, ...props }: HTMLMotionProps<'div'>) {
  return (
    <motion.div
      className={className}
      animate={{ y: [0, -10, 0] }}
      transition={{ duration: 7, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
      {...props}
    />
  )
}

export function HoverCard({
  className,
  hover = true,
  ...props
}: HTMLMotionProps<'div'> & {
  hover?: boolean
}) {
  return (
    <motion.div
      className={cn(className)}
      whileHover={
        hover
          ? {
              y: -6,
              scale: 1.01,
              transition: { duration: 0.22, ease },
            }
          : undefined
      }
      transition={{ duration: 0.22, ease }}
      {...props}
    />
  )
}
