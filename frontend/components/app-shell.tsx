'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { UserButton, useAuth } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import { Activity, BookOpen, FolderOpen, Languages, Link2, Menu, Sparkles, Upload, X } from 'lucide-react'
import { AuthSync } from '@/components/auth/auth-sync'
import { ThemeToggle } from '@/components/theme-toggle'
import { checkHealth, getTranslateInfo, type TranslateInfoResponse } from '@/lib/api'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/documents', label: 'Documents', icon: FolderOpen, description: 'Library and progress' },
  { href: '/upload', label: 'Upload', icon: Upload, description: 'Import PDF or DOCX' },
  { href: '/translate', label: 'Translate', icon: Languages, description: 'Review and export' },
  { href: '/glossary', label: 'Glossary', icon: BookOpen, description: 'Manage term pairs' },
]

interface AppShellProps {
  children: React.ReactNode
  title?: string
  subtitle?: string
  actions?: React.ReactNode
}

export function AppShell({ children, title, subtitle, actions }: AppShellProps) {
  const pathname = usePathname()
  const { isSignedIn } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [translateInfo, setTranslateInfo] = useState<TranslateInfoResponse | null>(null)

  useEffect(() => {
    checkHealth()
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'))

    getTranslateInfo()
      .then((info) => setTranslateInfo(info))
      .catch(() => setTranslateInfo(null))
  }, [])

  const backendName = translateInfo
    ? translateInfo.backend === 'groq'
      ? 'Groq'
      : translateInfo.backend === 'ollama'
        ? 'Ollama'
        : translateInfo.backend
    : null
  const backendChipLabel = backendName && translateInfo ? `${backendName} | ${translateInfo.model}` : null

  return (
    <div className="flex h-screen overflow-hidden bg-transparent">
      <AuthSync />

      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/30 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <motion.aside
        initial={{ x: -28, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-sidebar-border bg-sidebar/96 transition-transform duration-300 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0 shadow-xl shadow-slate-900/10' : '-translate-x-full'
        )}
      >
        <div className="border-b border-sidebar-border px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a,#155dfc,#16c5ff)] text-white shadow-lg shadow-cyan-500/15">
              <Languages className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold leading-none text-sidebar-foreground">Translation Studio</p>
              <p className="mt-1 text-xs text-sidebar-muted-foreground">Premium review workspace</p>
            </div>
            <button
              className="ml-auto rounded-xl p-2 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="flex-1 space-y-2 p-4">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-sidebar-muted-foreground">
            Workflow
          </p>
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'motion-card-subtle flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors',
                  isActive
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <div
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-xl',
                    isActive ? 'bg-sidebar-primary-foreground/15' : 'bg-background/70 text-sidebar-muted-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p
                    className={cn(
                      'truncate text-[11px]',
                      isActive ? 'text-sidebar-primary-foreground/75' : 'text-sidebar-muted-foreground'
                    )}
                  >
                    {item.description}
                  </p>
                </div>
              </Link>
            )
          })}

          <div className="mt-6 px-3">
            <div className="motion-card motion-sheen rounded-[1.6rem] border border-sidebar-border bg-[linear-gradient(180deg,rgba(12,22,42,0.96),rgba(22,40,78,0.94))] p-4 text-white shadow-[0_20px_50px_-35px_rgba(0,0,0,0.7)]">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-100">
                <Sparkles className="h-3 w-3" />
                Collaborative
              </div>
              <p className="mt-4 text-sm font-semibold">Need to loop in a reviewer?</p>
              <p className="mt-2 text-xs leading-6 text-slate-300">
                Generate a share link from any document and send teammates directly into the same translation context.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs text-cyan-100">
                <Link2 className="h-3.5 w-3.5" />
                Redirect-safe access after sign-in
              </div>
            </div>
          </div>
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="motion-card-subtle rounded-2xl border border-sidebar-border bg-background/70 p-4">
            <div className="flex items-center gap-2.5">
              <Activity className="h-3.5 w-3.5 text-sidebar-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-sidebar-foreground">Backend</p>
                <p className="text-[10px] text-sidebar-muted-foreground">localhost:8000</p>
              </div>
              <span
                className={cn(
                  'h-2.5 w-2.5 rounded-full',
                  apiStatus === 'online'
                    ? 'bg-emerald-500'
                    : apiStatus === 'offline'
                      ? 'bg-rose-500'
                      : 'animate-pulse bg-amber-500'
                )}
              />
            </div>
            {backendChipLabel && (
              <p className="mt-3 text-[11px] leading-relaxed text-sidebar-muted-foreground">
                Engine: <span className="font-medium text-sidebar-foreground">{backendChipLabel}</span>
              </p>
            )}
          </div>
        </div>
      </motion.aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-72">
        <motion.header
          initial={{ y: -14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
          className="sticky top-0 z-10 flex h-18 items-center gap-4 border-b border-border/70 bg-background/88 px-4 backdrop-blur md:px-6"
        >
          <button
            className="rounded-xl p-2 text-muted-foreground hover:bg-muted lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            {title && <h1 className="truncate text-lg font-semibold text-foreground">{title}</h1>}
            {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
          </div>

          {isSignedIn ? (
            <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 sm:flex">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-foreground">Authenticated workspace</p>
                <p className="text-[10px] text-muted-foreground">Synced to app database</p>
              </div>
            </div>
          ) : null}

          <ThemeToggle />
          {isSignedIn ? (
            <UserButton
              appearance={{
                elements: {
                  avatarBox: 'h-10 w-10',
                  userButtonPopoverCard: 'rounded-2xl',
                },
              }}
            />
          ) : null}
        </motion.header>

        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  )
}
