'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Activity, BookOpen, FolderOpen, Languages, Menu, Upload, X } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { checkHealth, getTranslateInfo, type TranslateInfoResponse } from '@/lib/api'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/documents', label: 'Documents', icon: FolderOpen, description: 'Library and progress' },
  { href: '/', label: 'Upload', icon: Upload, description: 'Import PDF or DOCX' },
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
  const groqKeyMissing = translateInfo?.backend === 'groq' && translateInfo.key_set === false

  return (
    <div className="flex min-h-screen bg-transparent">
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/30 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-sidebar-border bg-sidebar/96 transition-transform duration-300 lg:relative lg:translate-x-0',
          sidebarOpen ? 'translate-x-0 shadow-xl shadow-slate-900/10' : '-translate-x-full'
        )}
      >
        <div className="border-b border-sidebar-border px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sidebar-primary text-sidebar-primary-foreground">
              <Languages className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold leading-none text-sidebar-foreground">Syntra AI</p>
              <p className="mt-1 text-xs text-sidebar-muted-foreground">Structured review workspace</p>
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
                  'flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors',
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
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="rounded-2xl border border-sidebar-border bg-background/70 p-4">
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
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-18 items-center gap-4 border-b border-border/70 bg-background/88 px-4 backdrop-blur md:px-6">
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

          {backendChipLabel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'hidden rounded-full border px-3 py-1.5 text-xs font-medium md:flex',
                    groqKeyMissing
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
                      : 'border-border bg-background/75 text-muted-foreground'
                  )}
                >
                  {backendChipLabel}
                </div>
              </TooltipTrigger>
              {groqKeyMissing && (
                <TooltipContent side="bottom" sideOffset={8}>
                  GROQ_API_KEY is not configured.
                </TooltipContent>
              )}
            </Tooltip>
          )}

          <ThemeToggle />
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  )
}
