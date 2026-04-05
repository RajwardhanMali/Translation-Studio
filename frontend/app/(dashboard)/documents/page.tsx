'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Clock, File, FileCode, FileText, FolderOpen, LayoutGrid, Link2, List, Loader2, RefreshCw, Search, SearchX, Sparkles, Trash2, TrendingUp, UserPlus, Users, X } from 'lucide-react'
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
import { LayoutHeader } from '@/components/layout-context'
import { useDocuments, useShareOverview } from '@/hooks/use-dashboard-data'
import { createShareLink, deleteDocument, DocumentSummary } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { HoverCard, Reveal } from '@/components/motion/primitives'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/hooks/use-toast'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  addDocumentCollaborator,
  getDocumentCollaborators,
  removeDocumentCollaborator,
  type CollaboratorRole,
  type DocumentCollaborator,
  type DocumentCollaboratorsResponse,
} from '@/lib/api'

function CollaboratorsDialog({
  open,
  document,
  onOpenChange,
}: {
  open: boolean
  document: DocumentSummary | null
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<CollaboratorRole, 'owner'>>('editor')
  const [data, setData] = useState<DocumentCollaboratorsResponse | null>(null)

  useEffect(() => {
    if (!open || !document) return

    setLoading(true)
    void getDocumentCollaborators(document.id)
      .then((response) => setData(response))
      .catch((error) => {
        toast({
          title: 'Could not load collaborators',
          description: error instanceof Error ? error.message : 'The collaboration workspace could not be opened.',
          variant: 'destructive',
        })
        onOpenChange(false)
      })
      .finally(() => setLoading(false))
  }, [document, onOpenChange, open, toast])

  useEffect(() => {
    if (!open) {
      setEmail('')
      setRole('editor')
      setData(null)
    }
  }, [open])

  const canManage = data?.currentRole === 'owner'

  const handleAdd = async () => {
    if (!document || !email.trim()) return
    setSubmitting(true)
    try {
      const response = await addDocumentCollaborator(document.id, email.trim(), role)
      setData(response)
      setEmail('')
      toast({
        title: 'Collaborator added',
        description: 'The registered user now has access to this document.',
      })
    } catch (error) {
      toast({
        title: 'Could not add collaborator',
        description: error instanceof Error ? error.message : 'The collaborator could not be added.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemove = async (collaborator: DocumentCollaborator) => {
    if (!document) return
    setSubmitting(true)
    try {
      const response = await removeDocumentCollaborator(
        document.id,
        collaborator.collaboratorClerkUserId,
      )
      setData(response)
      toast({
        title: 'Collaborator removed',
        description: `${collaborator.collaboratorEmail} no longer has access.`,
      })
    } catch (error) {
      toast({
        title: 'Could not remove collaborator',
        description: error instanceof Error ? error.message : 'The collaborator could not be removed.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Shared Translation Space</DialogTitle>
          <DialogDescription>
            {document
              ? `Manage registered collaborators for ${document.filename}. Owners can invite editors and viewers here.`
              : 'Manage collaborators.'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        ) : data ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium text-foreground">
                  {data.collaborators.length} collaborator{data.collaborators.length === 1 ? '' : 's'}
                </p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Only registered users can collaborate. Editors will be the only non-owner role allowed to approve segments in later phases.
              </p>
            </div>

            {canManage ? (
              <div className="grid gap-3 rounded-2xl border border-border/70 bg-background/80 p-4 md:grid-cols-[1fr_160px_auto]">
                <Input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter a registered user's email"
                  className="rounded-xl"
                />
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as Exclude<CollaboratorRole, 'owner'>)}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  className="rounded-xl"
                  onClick={() => void handleAdd()}
                  disabled={submitting || !email.trim()}
                >
                  {submitting ? <Spinner className="mr-2 h-4 w-4" /> : <UserPlus className="mr-2 h-4 w-4" />}
                  Add
                </Button>
              </div>
            ) : (
              <div className="rounded-2xl border border-border/70 bg-background/80 p-4 text-sm text-muted-foreground">
                You can view collaborators on this document, but only the owner can add or remove team members.
              </div>
            )}

            <div className="space-y-3">
              {data.collaborators.map((collaborator) => (
                <div
                  key={collaborator.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {collaborator.collaboratorName || collaborator.collaboratorEmail}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {collaborator.collaboratorEmail}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full capitalize">
                      {collaborator.role}
                    </Badge>
                    {canManage && collaborator.role !== 'owner' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        disabled={submitting}
                        onClick={() => void handleRemove(collaborator)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

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
  canManage,
  onOpen,
  onDelete,
  onShare,
  onCollaborate,
}: {
  document: DocumentSummary
  deleting: boolean
  received: boolean
  canManage: boolean
  onOpen: () => void
  onDelete: () => Promise<void>
  onShare: () => Promise<void>
  onCollaborate: () => void
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
          <Button variant="outline" className="rounded-xl" onClick={onCollaborate}>
            <Users className="mr-1.5 h-4 w-4" />
            {canManage ? 'Team' : 'Members'}
          </Button>
          {canManage ? (
            <Button variant="outline" className="rounded-xl" onClick={() => void onShare()}>
              <Link2 className="mr-1.5 h-4 w-4" />
              Share
            </Button>
          ) : null}
          <Button variant="outline" className="rounded-xl" onClick={onOpen}>
            Open
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
          {canManage ? (
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
          ) : null}
        </div>
      </div>
    </HoverCard>
  )
}

function DocumentRow({
  document,
  deleting,
  received,
  canManage,
  onOpen,
  onDelete,
  onShare,
  onCollaborate,
}: {
  document: DocumentSummary
  deleting: boolean
  received: boolean
  canManage: boolean
  onOpen: () => void
  onDelete: () => Promise<void>
  onShare: () => Promise<void>
  onCollaborate: () => void
}) {
  const FileIcon = document.file_type === 'pdf' ? FileText : File

  return (
    <HoverCard
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel group relative flex items-center gap-4 rounded-2xl border border-border/70 p-4 transition-all duration-200 hover:border-primary/40 hover:bg-accent/10"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted transition-colors group-hover:bg-primary/10">
        <FileIcon className="h-5 w-5 text-foreground transition-colors group-hover:text-primary" />
      </div>
      
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <p className="truncate text-sm font-semibold text-foreground">{document.filename}</p>
          <FileTypeBadge fileType={document.file_type} />
          {received && (
            <Badge variant="outline" className="rounded-full border-cyan-200 bg-cyan-50 text-[10px] text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-200">
              Shared
            </Badge>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{document.blocks_count} blocks</span>
          {document.created_at && (
            <>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
              <span>{formatRelativeTime(document.created_at)}</span>
            </>
          )}
        </div>
      </div>

      <div className="hidden w-48 shrink-0 flex-col gap-1.5 md:flex">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{Math.round(document.translation_progress)}% complete</span>
          <span>{document.segments.total} segs</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="flex h-full">
            <div className="bg-slate-300 dark:bg-slate-700" style={{ width: `${(document.segments.pending / Math.max(document.segments.total, 1)) * 100}%` }} />
            <div className="bg-amber-400" style={{ width: `${(document.segments.reviewed / Math.max(document.segments.total, 1)) * 100}%` }} />
            <div className="bg-emerald-500" style={{ width: `${(document.segments.approved / Math.max(document.segments.total, 1)) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-primary/10 hover:text-primary" onClick={onCollaborate}>
          <Users className="h-4 w-4" />
        </Button>
        {canManage ? (
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-primary/10 hover:text-primary" onClick={() => void onShare()}>
            <Link2 className="h-4 w-4" />
          </Button>
        ) : null}
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-primary/10 hover:text-primary" onClick={onOpen}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        {canManage ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete document?</AlertDialogTitle>
                <AlertDialogDescription>
                  {document.filename} will be removed from your library.
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
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </HoverCard>
  )
}

export default function DocumentsPage() {
  const router = useRouter()
  const { toast } = useToast()
  
  // Use store-backed hooks for centralized state and deduplication
  const { documents, isLoading: loading, mutate: mutateDocs } = useDocuments()
  const { shareOverview, mutate: mutateShares } = useShareOverview()
  
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'personal' | 'shared'>('all')
  const [collaborationDocument, setCollaborationDocument] = useState<DocumentSummary | null>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([mutateDocs(), mutateShares()])
    } finally {
      setRefreshing(false)
    }
  }

  const totals = useMemo(
    () =>
      documents.reduce(
        (acc, doc) => {
          acc.total += 1
          acc.pending += doc.segments.pending
          acc.reviewed += doc.segments.reviewed
          acc.approved += doc.segments.approved
          acc.totalProgress += doc.translation_progress
          return acc
        },
        { total: 0, pending: 0, reviewed: 0, approved: 0, totalProgress: 0 }
      ),
    [documents]
  )

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const matchesSearch = doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
      const isReceived = !doc.is_owner
      
      if (activeTab === 'personal') return matchesSearch && !isReceived
      if (activeTab === 'shared') return matchesSearch && isReceived
      return matchesSearch
    })
  }, [documents, searchQuery, activeTab, shareOverview.receivedDocumentIds])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteDocument(id)
      await mutateDocs() // Refresh cache
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
    <>
      <LayoutHeader
        title="Documents"
        subtitle="Browse uploaded files, track progress, and reopen any document."
      />
      <CollaboratorsDialog
        open={Boolean(collaborationDocument)}
        document={collaborationDocument}
        onOpenChange={(open) => {
          if (!open) setCollaborationDocument(null)
        }}
      />
      <div className="space-y-5">
      <div className="relative space-y-7">
        {/* Visual Polish: Background Spotlight */}
        <div className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-[600px] w-[1000px] -translate-x-1/2 opacity-25 blur-[140px] dark:opacity-15">
          <div className="h-full w-full bg-gradient-to-br from-primary/30 via-purple-500/20 to-blue-600/30" />
        </div>

        {/* Hero Section with Integrated Stats */}
        <Reveal className="hero-sheen overflow-hidden rounded-[2.5rem] border border-border/60 bg-background/20 backdrop-blur-sm">
          <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-10 lg:py-10">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                  Dashboard
                </Badge>
                <div className="h-px w-8 bg-border/60" />
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">Document Hub</span>
              </div>
              <h2 className="mt-6 text-4xl font-bold tracking-tight text-foreground md:text-5xl lg:text-6xl">
                Ready to <span className="text-primary italic">translate</span> & collaborate?
              </h2>
              <p className="mt-6 max-w-xl text-sm leading-8 text-muted-foreground md:text-lg">
                Manage your translation pipeline with ease. Track progress across files, 
                generate secure share links, and jump back into your work instantly.
              </p>
              
              <div className="mt-10 flex flex-wrap gap-4">
                <Button className="h-12 rounded-2xl bg-primary px-8 text-base font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30" onClick={() => router.push('/upload')}>
                  <Sparkles className="mr-2 h-5 w-5" />
                  New Project
                </Button>
                <Button variant="outline" className="glass-panel h-12 rounded-2xl border-border/50 bg-background/40 px-6 font-medium hover:bg-accent/50" onClick={handleRefresh} disabled={refreshing}>
                  <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
                  Refresh Library
                </Button>
              </div>
            </div>

            <Card className="motion-card motion-sheen relative overflow-hidden rounded-[2.25rem] border-border/40 bg-gradient-to-br from-background/90 to-background/50 p-6 shadow-2xl md:p-8">
              <div className="relative z-10 grid h-full grid-cols-2 gap-4">
                {[
                  { label: 'Documents', value: totals.total, icon: FileCode, color: 'text-primary' },
                  { label: 'Pending', value: totals.pending, icon: Clock, color: 'text-slate-500' },
                  { label: 'Reviewed', value: totals.reviewed, icon: TrendingUp, color: 'text-amber-500' },
                  { label: 'Approved', value: totals.approved, icon: CheckCircle2, color: 'text-emerald-500' },
                ].map((stat) => (
                  <div key={stat.label} className="flex flex-col justify-between rounded-[1.5rem] bg-muted/40 p-4 transition-colors hover:bg-muted/60">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl bg-background/80 shadow-sm", stat.color)}>
                      <stat.icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="mt-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">{stat.label}</p>
                      <p className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">{stat.value}</p>
                    </div>
                  </div>
                ))}
                
                <div className="col-span-2 mt-2 flex flex-col justify-end rounded-[1.5rem] bg-primary/5 p-4 border border-primary/10">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-widest text-primary">
                    <span>Overall Progress</span>
                    <span>{totals.total > 0 ? Math.round(totals.totalProgress / totals.total) : 0}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-primary/10">
                    <div 
                      className="h-full bg-primary shadow-[0_0_20px_rgba(var(--primary),0.5)] transition-all duration-1000 ease-out" 
                      style={{ width: `${totals.total > 0 ? totals.totalProgress / totals.total : 0}%` }} 
                    />
                  </div>
                </div>
              </div>
              
              {/* Subtle background decoration for the stats card */}
              <div className="absolute -right-4 -top-4 -z-0 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
              <div className="absolute -bottom-4 -left-4 -z-0 h-32 w-32 rounded-full bg-purple-500/10 blur-3xl" />
            </Card>
          </div>
        </Reveal>

        {/* Global Controls & Filtering */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between lg:mt-4">
          <div className="flex flex-1 items-center gap-4">
            <Tabs 
              value={activeTab} 
              onValueChange={(v) => setActiveTab(v as any)} 
              className="w-fit"
            >
              <TabsList className="glass-panel h-12 rounded-2xl border-border/50 bg-background/50 p-1 backdrop-blur-md">
                <TabsTrigger value="all" className="rounded-xl px-5 text-xs font-semibold tracking-wide data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg">
                  All Files <span className="ml-2 opacity-60 text-[10px]">{documents.length}</span>
                </TabsTrigger>
                <TabsTrigger value="personal" className="rounded-xl px-5 text-xs font-semibold tracking-wide data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg">
                  Personal
                </TabsTrigger>
                <TabsTrigger value="shared" className="rounded-xl px-5 text-xs font-semibold tracking-wide data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg">
                  Shared
                </TabsTrigger>
              </TabsList>
            </Tabs>
            
            <div className="relative hidden max-w-sm flex-1 md:block">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                placeholder="Find a document..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="glass-panel h-12 rounded-2xl border-border/50 bg-background/50 pl-11 pr-10 text-sm focus-visible:ring-primary/30 transition-all hover:border-primary/30"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-2xl border border-border/50 bg-background/50 p-1.5 backdrop-blur-sm shadow-inner">
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-9 w-10 rounded-xl p-0 transition-all', viewMode === 'grid' ? 'bg-primary text-primary-foreground shadow-md' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="h-4.5 w-4.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-9 w-10 rounded-xl p-0 transition-all', viewMode === 'list' ? 'bg-primary text-primary-foreground shadow-md' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}
                onClick={() => setViewMode('list')}
              >
                <List className="h-4.5 w-4.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile Search Overlay */}
        <div className="relative block md:hidden">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="glass-panel h-12 rounded-2xl border-border/50 bg-background/50 pl-11 focus-visible:ring-primary/30"
          />
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
        ) : filteredDocuments.length === 0 ? (
          <div className="glass-panel flex flex-col items-center gap-4 rounded-3xl py-24 text-center">
            <SearchX className="h-10 w-10 text-muted-foreground/40" />
            <div className="space-y-1">
              <p className="text-lg font-semibold text-foreground">No matches found</p>
              <p className="text-sm text-muted-foreground">Adjust your filters or try a different search term.</p>
            </div>
            <Button variant="outline" className="rounded-xl" onClick={() => { setSearchQuery(''); setActiveTab('all'); }}>
              Clear all filters
            </Button>
          </div>
        ) : (
          <motion.div layout className={cn('grid gap-4', viewMode === 'grid' ? 'xl:grid-cols-3' : 'grid-cols-1')}>
            <AnimatePresence mode="popLayout">
            {filteredDocuments.map((document) => (
              viewMode === 'grid' ? (
                <DocumentCard
                  key={document.id}
                  document={document}
                  deleting={deletingId === document.id}
                  received={!document.is_owner}
                  canManage={document.access_role === 'owner'}
                  onOpen={() => router.push(`/translate?doc=${document.id}`)}
                  onDelete={() => handleDelete(document.id)}
                  onShare={() => handleShare(document.id)}
                  onCollaborate={() => setCollaborationDocument(document)}
                />
              ) : (
                <DocumentRow
                  key={document.id}
                  document={document}
                  deleting={deletingId === document.id}
                  received={!document.is_owner}
                  canManage={document.access_role === 'owner'}
                  onOpen={() => router.push(`/translate?doc=${document.id}`)}
                  onDelete={() => handleDelete(document.id)}
                  onShare={() => handleShare(document.id)}
                  onCollaborate={() => setCollaborationDocument(document)}
                />
              )
            ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
      </div>
    </>
  )
}
