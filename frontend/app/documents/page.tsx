'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, File, FileText, FolderOpen, Link2, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { AppShell } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { HoverCard, Reveal } from '@/components/motion/primitives'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/hooks/use-toast'
import { createShareLink, deleteDocument, getDocuments, getShareOverview, type DocumentSummary, type ShareOverviewResponse } from '@/lib/api'
import { cn } from '@/lib/utils'

function formatRelativeTime(value: string) {
  const target = new Date(value).getTime()
  const now = Date.now()

  // Handle invalid dates
  if (isNaN(target)) {
    return 'Unknown'
  }

  const diffSeconds = Math.round((now - target) / 1000)
  const absSeconds = Math.abs(diffSeconds)
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ]

  for (const [unit, seconds] of ranges) {
    if (absSeconds >= seconds || unit === 'second') {
      return formatter.format(Math.round(diffSeconds / seconds), unit)
    }
  }

  return 'just now'
}

function FileTypeBadge({ fileType }: { fileType: DocumentSummary['file_type'] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase',
        fileType === 'pdf'
          ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'
          : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200'
      )}
    >
      {fileType}
    </Badge>
  )
}

function StackedProgress({ document }: { document: DocumentSummary }) {
  const total = Math.max(document.segments.total, 1)
  const pendingWidth = (document.segments.pending / total) * 100
  const reviewedWidth = (document.segments.reviewed / total) * 100
  const approvedWidth = (document.segments.approved / total) * 100

  return (
    <div className="space-y-2.5">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="flex h-full w-full">
          <div className="bg-slate-300 dark:bg-slate-700" style={{ width: `${pendingWidth}%` }} />
          <div className="bg-amber-400" style={{ width: `${reviewedWidth}%` }} />
          <div className="bg-emerald-500" style={{ width: `${approvedWidth}%` }} />
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{document.translation_progress.toFixed(1)}% translated</span>
        <span>{document.segments.total} segments</span>
      </div>
    </div>
  )
}

function DocumentCard({
  document,
  deleting,
  received,
  onOpen,
  onDelete,
  onShare,
}: {
  document: DocumentSummary
  deleting: boolean
  received: boolean
  onOpen: () => void
  onDelete: () => Promise<void>
  onShare: () => Promise<void>
}) {
  const FileIcon = document.file_type === 'pdf' ? FileText : File

  return (
    <HoverCard
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel rounded-3xl p-5"
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted">
              <FileIcon className="h-5 w-5 text-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">{document.filename}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <FileTypeBadge fileType={document.file_type} />
                {received ? (
                  <Badge variant="outline" className="rounded-full border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-200">
                    Shared doc
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">{document.blocks_count} blocks</span>
                {document.created_at ? (
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(document.created_at)}</span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Progress</p>
            <p className="text-lg font-semibold text-foreground">{Math.round(document.translation_progress)}%</p>
          </div>
        </div>

        <StackedProgress document={document} />

        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-2xl bg-muted/70 px-3 py-2 text-muted-foreground">Pending {document.segments.pending}</div>
          <div className="rounded-2xl bg-muted/70 px-3 py-2 text-muted-foreground">Reviewed {document.segments.reviewed}</div>
          <div className="rounded-2xl bg-muted/70 px-3 py-2 text-muted-foreground">Approved {document.segments.approved}</div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => void onShare()}>
            <Link2 className="mr-1.5 h-4 w-4" />
            Share
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={onOpen}>
            Open
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="rounded-xl border-red-200 text-red-700 hover:bg-red-50 hover:text-red-700 dark:border-red-900/60 dark:text-red-200 dark:hover:bg-red-950/40">
                {deleting ? <Spinner className="mr-1.5 h-4 w-4" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete document?</AlertDialogTitle>
                <AlertDialogDescription>
                  {document.filename} will be removed from your library. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault()
                    void onDelete()
                  }}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </HoverCard>
  )
}

export default function DocumentsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [shareOverview, setShareOverview] = useState<ShareOverviewResponse>({
    ownedByDocument: {},
    receivedDocumentIds: [],
  })

  const loadDocuments = async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)

    try {
      const [data, shareData] = await Promise.all([
        getDocuments(),
        getShareOverview().catch(() => ({
          ownedByDocument: {},
          receivedDocumentIds: [],
        })),
      ])
      setDocuments(data)
      setShareOverview(shareData)
    } catch {
      toast({
        title: 'Failed to load documents',
        description: 'Could not fetch your document library from the backend.',
        variant: 'destructive',
      })
      setDocuments([])
      setShareOverview({ ownedByDocument: {}, receivedDocumentIds: [] })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadDocuments()
    const interval = window.setInterval(() => {
      void loadDocuments(true)
    }, 30000)
    return () => window.clearInterval(interval)
  }, [])

  const totals = useMemo(
    () =>
      documents.reduce(
        (acc, doc) => {
          acc.total += 1
          acc.pending += doc.segments.pending
          acc.reviewed += doc.segments.reviewed
          acc.approved += doc.segments.approved
          return acc
        },
        { total: 0, pending: 0, reviewed: 0, approved: 0 }
      ),
    [documents]
  )

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteDocument(id)
      setDocuments((prev) => prev.filter((doc) => doc.id !== id))
      toast({ title: 'Document deleted', description: 'The document was removed from your library.' })
    } catch {
      toast({
        title: 'Delete failed',
        description: 'The document could not be deleted. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setDeletingId(null)
    }
  }

  const handleShare = async (documentId: string) => {
    try {
      const share = await createShareLink(documentId)
      const absoluteUrl = `${window.location.origin}${share.shareUrl}`
      await navigator.clipboard.writeText(absoluteUrl)
      toast({
        title: 'Share link copied',
        description: 'The link has been copied to your clipboard.',
      })
    } catch {
      toast({
        title: 'Share link failed',
        description: 'We could not create a share link for this document.',
        variant: 'destructive',
      })
    }
  }

  return (
    <AppShell
      title="Documents"
      subtitle="Browse uploaded files, track progress, and reopen any document."
    >
      <div className="space-y-5">
        <Reveal className="hero-sheen overflow-hidden rounded-[2rem] border border-border/70">
          <div className="grid gap-6 px-6 py-7 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Document operations</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                Your active translation pipeline, ready to reopen, review, and share.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
                Monitor progress across uploaded files, jump back into translation, and generate secure share links
                when reviewers need access to the same document context.
              </p>
            </div>

            <Card className="motion-card motion-sheen rounded-[1.75rem] border-border/60 bg-background/75 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Team-ready workflow</p>
                  <p className="text-sm text-muted-foreground">Share links route collaborators into the right file after login.</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-2xl" onClick={() => void loadDocuments(true)} disabled={refreshing}>
                  <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
                  Refresh
                </Button>
                <Button className="rounded-2xl" onClick={() => router.push('/upload')}>
                  Upload Document
                </Button>
              </div>
            </Card>
          </div>
        </Reveal>

        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: 'Documents', value: totals.total },
            { label: 'Pending', value: totals.pending },
            { label: 'Reviewed', value: totals.reviewed },
            { label: 'Approved', value: totals.approved },
          ].map((item, index) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.45, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
            >
            <Card className={cn('rounded-2xl border-border/70 p-4')}>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
            </Card>
            </motion.div>
          ))}
        </div>

        {loading ? (
          <div className="glass-panel flex flex-col items-center gap-4 rounded-3xl py-24">
            <Spinner className="h-8 w-8 text-primary" />
            <p className="text-sm text-muted-foreground">Loading documents...</p>
          </div>
        ) : documents.length === 0 ? (
          <Card className="glass-panel flex flex-col items-center gap-4 rounded-3xl py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-muted">
              <FolderOpen className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-semibold text-foreground">No documents yet</p>
              <p className="text-sm text-muted-foreground">Upload one to get started.</p>
            </div>
            <Button className="rounded-xl" onClick={() => router.push('/upload')}>
              Upload Document
            </Button>
          </Card>
        ) : (
          <motion.div layout className="grid gap-4 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
            {documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                deleting={deletingId === document.id}
                received={shareOverview.receivedDocumentIds.includes(document.id)}
                onOpen={() => router.push(`/translate?doc=${document.id}`)}
                onDelete={() => handleDelete(document.id)}
                onShare={() => handleShare(document.id)}
              />
            ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </AppShell>
  )
}
