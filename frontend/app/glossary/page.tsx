'use client'

import { useState, useEffect } from 'react'
import {
  BookOpen,
  Plus,
  Trash2,
  Search,
  Edit2,
  Check,
  X,
  Globe,
  Tag,
  StickyNote,
} from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { getGlossary, addGlossaryTerm, type GlossaryTerm } from '@/lib/api'
import { cn } from '@/lib/utils'

const DOMAIN_COLORS: Record<string, string> = {
  Finance: 'bg-blue-50 text-blue-700 border-blue-200',
  Corporate: 'bg-slate-100 text-slate-700 border-slate-200',
  ESG: 'bg-green-50 text-green-700 border-green-200',
  Technology: 'bg-purple-50 text-purple-700 border-purple-200',
  Operations: 'bg-orange-50 text-orange-700 border-orange-200',
  Legal: 'bg-red-50 text-red-700 border-red-200',
  Marketing: 'bg-pink-50 text-pink-700 border-pink-200',
}

function DomainBadge({ domain }: { domain: string }) {
  const cls = DOMAIN_COLORS[domain] || 'bg-muted text-muted-foreground border-border'
  return (
    <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium', cls)}>
      {domain}
    </span>
  )
}

const EMPTY_TERM: Omit<GlossaryTerm, 'id'> = {
  source: '',
  target: '',
  language: 'fr',
  domain: '',
  notes: '',
}

export default function GlossaryPage() {
  const { toast } = useToast()
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [domainFilter, setDomainFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formData, setFormData] = useState(EMPTY_TERM)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const loadGlossary = async () => {
    setLoading(true)
    try {
      const data = await getGlossary()
      if (Array.isArray(data)) {
        setTerms(data)
      } else {
        setTerms([])
      }
    } catch (err) {
      toast({
        title: 'Failed to load glossary',
        description:
          'Could not fetch glossary terms from the backend. Ensure the API is running and the URL is configured correctly.',
        variant: 'destructive',
      })
      setTerms([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadGlossary() }, [])

  const handleAdd = async () => {
    if (!formData.source.trim() || !formData.target.trim()) {
      toast({ title: 'Required fields', description: 'Source and target terms are required.', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const added = await addGlossaryTerm(formData)
      setTerms((prev) => [...prev, added])
      toast({ title: 'Term added', description: `"${formData.source}" → "${formData.target}"` })
    } catch (err) {
      toast({
        title: 'Failed to add term',
        description: 'Could not save the term. Please check your connection and try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
      setDialogOpen(false)
      setFormData(EMPTY_TERM)
    }
  }

  const handleDelete = (id: string | undefined) => {
    if (!id) return
    setTerms((prev) => prev.filter((t) => t.id !== id))
    toast({ title: 'Term removed' })
  }

  const handleEditSave = (id: string | undefined, updated: GlossaryTerm) => {
    if (!id) return
    setTerms((prev) => prev.map((t) => (t.id === id ? updated : t)))
    setEditingId(null)
    toast({ title: 'Term updated' })
  }

  // Defensive: ensure terms is always an array
  const safeTerms: GlossaryTerm[] = Array.isArray(terms) ? terms : []
  const domains = ['all', ...Array.from(new Set(safeTerms.map((t) => t.domain).filter(Boolean)))]

  const filtered = safeTerms.filter((t) => {
    const matchSearch =
      !searchQuery ||
      t.source.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.target.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.domain.toLowerCase().includes(searchQuery.toLowerCase())
    const matchDomain = domainFilter === 'all' || t.domain === domainFilter
    return matchSearch && matchDomain
  })

  return (
    <AppShell
      title="Glossary Manager"
      subtitle={`${safeTerms.length} term pairs across ${domains.length - 1} domains`}
      actions={
        <Button onClick={() => setDialogOpen(true)} className="rounded-xl">
          <Plus className="mr-2 h-4 w-4" />
          Add Term
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Controls */}
        <Card className="rounded-2xl p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search terms…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 rounded-xl h-9 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {domains.map((d) => (
                <button
                  key={d}
                  onClick={() => setDomainFilter(d)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors',
                    domainFilter === d
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Total terms', value: safeTerms.length, icon: BookOpen },
            { label: 'Domains', value: domains.length - 1, icon: Tag },
            { label: 'Languages', value: Array.from(new Set(safeTerms.map((t) => t.language))).length, icon: Globe },
            { label: 'With notes', value: safeTerms.filter((t) => t.notes).length, icon: StickyNote },
          ].map((s) => (
            <Card key={s.label} className="flex items-center gap-3 rounded-2xl p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <s.icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none text-foreground">{loading ? '—' : s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            </Card>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex flex-col items-center gap-4 py-24">
            <Spinner className="h-8 w-8 text-primary" />
            <p className="text-sm text-muted-foreground">Loading glossary…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card py-16">
            <BookOpen className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">No terms found</p>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)} className="rounded-xl">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add First Term
            </Button>
          </div>
        ) : (
          <Card className="overflow-hidden rounded-2xl">
            {/* Header */}
            <div className="grid grid-cols-[1fr_1fr_80px_80px_1fr_80px] gap-0 border-b border-border bg-muted/40 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <div>Source</div>
              <div>Target</div>
              <div>Language</div>
              <div>Domain</div>
              <div>Notes</div>
              <div className="text-right">Actions</div>
            </div>
            <div className="divide-y divide-border">
              {filtered.map((term) => (
                <TermRow
                  key={term.id}
                  term={term}
                  isEditing={editingId === term.id}
                  onEdit={() => setEditingId(term.id ?? null)}
                  onSave={(updated) => handleEditSave(term.id, updated)}
                  onCancel={() => setEditingId(null)}
                  onDelete={() => handleDelete(term.id)}
                />
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Add Term Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Glossary Term</DialogTitle>
            <DialogDescription>
              Define a source-target term pair to ensure consistency across translations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="source" className="text-xs">Source Term *</Label>
                <Input
                  id="source"
                  placeholder="e.g. Revenue"
                  value={formData.source}
                  onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="target" className="text-xs">Target Term *</Label>
                <Input
                  id="target"
                  placeholder="e.g. Chiffre d'affaires"
                  value={formData.target}
                  onChange={(e) => setFormData({ ...formData, target: e.target.value })}
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="language" className="text-xs">Target Language</Label>
                <Input
                  id="language"
                  placeholder="e.g. fr, es, de"
                  value={formData.language}
                  onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="domain" className="text-xs">Domain</Label>
                <Input
                  id="domain"
                  placeholder="e.g. Finance, Legal"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-xs">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Usage guidelines, context, or restrictions…"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="rounded-xl resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={saving} className="rounded-xl">
              {saving ? <Spinner className="mr-2 h-3.5 w-3.5" /> : <Plus className="mr-2 h-4 w-4" />}
              Add Term
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}

function TermRow({
  term,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  term: GlossaryTerm
  isEditing: boolean
  onEdit: () => void
  onSave: (updated: GlossaryTerm) => void
  onCancel: () => void
  onDelete: () => void
}) {
  const [local, setLocal] = useState(term)

  useEffect(() => { setLocal(term) }, [term])

  if (isEditing) {
    return (
      <div className="grid grid-cols-[1fr_1fr_80px_80px_1fr_80px] gap-0 items-center px-4 py-3 bg-accent/30">
        <Input
          value={local.source}
          onChange={(e) => setLocal({ ...local, source: e.target.value })}
          className="h-8 rounded-lg text-sm mr-2"
        />
        <Input
          value={local.target}
          onChange={(e) => setLocal({ ...local, target: e.target.value })}
          className="h-8 rounded-lg text-sm mr-2"
        />
        <Input
          value={local.language}
          onChange={(e) => setLocal({ ...local, language: e.target.value })}
          className="h-8 rounded-lg text-xs mr-2"
        />
        <Input
          value={local.domain}
          onChange={(e) => setLocal({ ...local, domain: e.target.value })}
          className="h-8 rounded-lg text-xs mr-2"
        />
        <Input
          value={local.notes}
          onChange={(e) => setLocal({ ...local, notes: e.target.value })}
          className="h-8 rounded-lg text-xs mr-2"
        />
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" className="h-7 w-7 p-0 rounded-lg" onClick={() => onSave(local)}>
            <Check className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="outline" className="h-7 w-7 p-0 rounded-lg" onClick={onCancel}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="group grid grid-cols-[1fr_1fr_80px_80px_1fr_80px] gap-0 items-center px-4 py-3.5 hover:bg-muted/30 transition-colors">
      <p className="text-sm font-medium text-foreground pr-2">{term.source}</p>
      <p className="text-sm text-foreground pr-2">{term.target}</p>
      <span className="text-xs font-mono text-muted-foreground uppercase pr-2">{term.language}</span>
      <div className="pr-2">
        <DomainBadge domain={term.domain} />
      </div>
      <p className="text-xs text-muted-foreground line-clamp-1 pr-2">{term.notes || '—'}</p>
      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 rounded-lg"
          onClick={onEdit}
        >
          <Edit2 className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 rounded-lg text-destructive hover:bg-destructive/10"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
