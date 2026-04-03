'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Info, RefreshCw, ShieldCheck, Wand2 } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { HoverCard, Reveal } from '@/components/motion/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/hooks/use-toast'
import { approveSegment, validateDocument, type ValidationIssue, type ValidationResult } from '@/lib/api'
import { cn } from '@/lib/utils'

function SeverityBadge({ severity }: { severity: ValidationIssue['severity'] }) {
  const isWarning = severity === 'warning'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        isWarning
          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200'
          : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-200'
      )}
    >
      {isWarning ? <AlertTriangle className="h-2.5 w-2.5" /> : <Info className="h-2.5 w-2.5" />}
      {severity}
    </span>
  )
}

function ValidationCard({
  result,
  showInfo,
  onApplyFix,
  applying,
}: {
  result: ValidationResult
  showInfo: boolean
  onApplyFix: () => Promise<void>
  applying: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const visibleIssues = showInfo ? result.issues : result.issues.filter((issue) => issue.severity === 'warning')
  const hiddenInfoCount = result.issues.length - visibleIssues.length
  const hasWarning = visibleIssues.some((issue) => issue.severity === 'warning')

  return (
    <HoverCard layout className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <button
        className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/30"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className={cn('mt-0.5 rounded-full p-1', hasWarning ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200')}>
          {hasWarning ? <AlertTriangle className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm leading-7 text-foreground">{result.text}</p>
            {result.segment_id && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {result.segment_id.slice(0, 10)}
              </Badge>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {visibleIssues.map((issue, index) => (
              <SeverityBadge key={`${issue.issue_type}-${index}`} severity={issue.severity} />
            ))}
            {!showInfo && hiddenInfoCount > 0 && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                +{hiddenInfoCount} info hidden
              </Badge>
            )}
          </div>
        </div>

        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border/60 px-4 py-4">
          {visibleIssues.map((issue, index) => (
            <div key={`${issue.issue_type}-${index}`} className="rounded-2xl bg-muted/35 p-3">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={issue.severity} />
                <Badge variant="outline" className="font-mono text-[10px]">
                  {issue.issue_type}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-foreground">{issue.issue}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Suggestion:</span> {issue.suggestion}
              </p>
            </div>
          ))}

          {result.auto_fixed_text && result.segment_id && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-background/70 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">Suggested correction</p>
                <p className="mt-1 text-sm text-muted-foreground">{result.auto_fixed_text}</p>
              </div>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={() => void onApplyFix()} disabled={applying}>
                {applying ? <Spinner className="mr-1.5 h-3.5 w-3.5" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                Apply
              </Button>
            </div>
          )}
        </div>
      )}
    </HoverCard>
  )
}

function ValidationPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const docId = searchParams.get('doc') ?? ''

  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ValidationResult[]>([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [applyingId, setApplyingId] = useState<string | null>(null)

  const loadValidation = async (autoFix = true) => {
    setLoading(true)

    if (!docId) {
      setResults([])
      setHasLoaded(true)
      setLoading(false)
      return
    }

    try {
      const data = await validateDocument(docId, autoFix)
      setResults(data)
      setHasLoaded(true)
    } catch {
      toast({
        title: 'Validation failed',
        description: 'Could not validate the document. Ensure the backend is running and the API URL is configured correctly.',
        variant: 'destructive',
      })
      setResults([])
      setHasLoaded(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadValidation(true)
  }, [docId])

  const counts = useMemo(
    () =>
      results.reduce(
        (acc, result) => {
          for (const issue of result.issues) {
            acc[issue.severity] += 1
          }
          return acc
        },
        { error: 0, warning: 0, info: 0 }
      ),
    [results]
  )

  const visibleResults = useMemo(() => {
    if (showInfo) return results
    return results.filter((result) => result.issues.some((issue) => issue.severity === 'warning'))
  }, [results, showInfo])

  const handleApplyFix = async (result: ValidationResult) => {
    if (!result.segment_id || !result.auto_fixed_text) return

    setApplyingId(result.segment_id)
    try {
      await approveSegment(result.segment_id, false, result.auto_fixed_text)
      setResults((prev) =>
        prev
          .map((item) =>
            item.segment_id === result.segment_id
              ? { ...item, text: result.auto_fixed_text ?? item.text, issues: [], has_errors: false, has_warnings: false }
              : item
          )
          .filter((item) => item.issues.length > 0)
      )
      toast({ title: 'Fix applied', description: 'The correction was sent back to the document.' })
    } catch {
      toast({
        title: 'Could not apply fix',
        description: 'The correction could not be saved to the backend.',
        variant: 'destructive',
      })
    } finally {
      setApplyingId(null)
    }
  }

  return (
    <AppShell
      title="Validation"
      subtitle={docId ? `Document ${docId.slice(0, 20)}...` : 'Validation results'}
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <Reveal className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void loadValidation(true)} disabled={loading}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            Re-check
          </Button>
          <Button size="sm" className="rounded-xl" onClick={() => router.push(`/translate?doc=${docId}`)}>
            Continue
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Segments with issues', value: results.length, icon: ShieldCheck },
            { label: 'Errors', value: counts.error, icon: AlertTriangle },
            { label: 'Warnings', value: counts.warning, icon: AlertTriangle },
            { label: 'Info', value: counts.info, icon: Info },
          ].map((item, index) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.45, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
            >
            <Card className="rounded-2xl border-border/70 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                  <item.icon className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-foreground">{loading ? '-' : item.value}</p>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                </div>
              </div>
            </Card>
            </motion.div>
          ))}
        </div>

        {loading ? (
          <div className="glass-panel flex flex-col items-center gap-4 rounded-3xl py-24">
            <Spinner className="h-8 w-8 text-primary" />
            <p className="text-sm text-muted-foreground">Checking document...</p>
          </div>
        ) : hasLoaded && results.length === 0 ? (
          <Card className="glass-panel flex flex-col items-center gap-3 rounded-3xl py-16 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-300" />
            <p className="text-lg font-semibold text-foreground">No issues found</p>
            <p className="text-sm text-muted-foreground">This document is clean and ready for the next step.</p>
          </Card>
        ) : hasLoaded ? (
          <div className="space-y-4">
            <Reveal className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
              <p className="text-sm text-foreground">
                {results.length} segment{results.length === 1 ? '' : 's'} need attention.
              </p>
              {counts.info > 0 && (
                <button className="text-sm font-medium text-primary hover:underline" onClick={() => setShowInfo((value) => !value)}>
                  {showInfo ? 'Hide info items' : `Show info items (${counts.info})`}
                </button>
              )}
            </Reveal>

            {visibleResults.length === 0 ? (
              <Card className="rounded-2xl border-border/70 p-5 text-sm text-muted-foreground">
                Only informational notes were returned. Turn on info items to review them.
              </Card>
            ) : (
              <AnimatePresence mode="popLayout">
                {visibleResults.map((result, index) => (
                  <motion.div
                    key={result.segment_id ?? `${result.text}-${index}`}
                    layout
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.35, delay: index * 0.03, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <ValidationCard
                      result={result}
                      showInfo={showInfo}
                      onApplyFix={() => handleApplyFix(result)}
                      applying={applyingId === result.segment_id}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}

export default function ValidatePage() {
  return (
    <Suspense>
      <ValidationPageContent />
    </Suspense>
  )
}
