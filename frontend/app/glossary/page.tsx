'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Globe2, Plus, Search, Sparkles, Tag } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { addGlossaryTerm, getGlossary, type GlossaryResponse, type GlossaryTerm } from '@/lib/api'
import { cn } from '@/lib/utils'

const EMPTY_TERM: GlossaryTerm = {
  source: '',
  target: '',
  language: 'fr',
  domain: '',
  notes: '',
}

function DomainChip({ domain }: { domain: string }) {
  const palette: Record<string, string> = {
    legal: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200',
    technology:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200',
    finance:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
  }

  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium',
        palette[domain.toLowerCase()] ?? 'border-border bg-muted text-muted-foreground'
      )}
    >
      {domain}
    </span>
  )
}

export default function GlossaryPage() {
  const { toast } = useToast()
  const [glossary, setGlossary] = useState<GlossaryResponse>({ terms: [], style_rules: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [formData, setFormData] = useState<GlossaryTerm>(EMPTY_TERM)

  const loadGlossary = async () => {
    setLoading(true)

    try {
      const data = await getGlossary()
      setGlossary(data)
    } catch {
      toast({
        title: 'Failed to load glossary',
        description: 'Could not fetch glossary terms from the backend.',
        variant: 'destructive',
      })
      setGlossary({ terms: [], style_rules: [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadGlossary()
  }, [])

  const filteredTerms = useMemo(() => {
    return glossary.terms.filter((term) => {
      const haystack = [term.source, term.target, term.language, term.domain ?? '', term.notes ?? ''].join(' ').toLowerCase()
      return haystack.includes(query.toLowerCase())
    })
  }, [glossary.terms, query])

  const stats = useMemo(
    () => ({
      termCount: glossary.terms.length,
      languageCount: new Set(glossary.terms.map((term) => term.language)).size,
      domainCount: new Set(glossary.terms.map((term) => term.domain).filter(Boolean)).size,
      rulesCount: glossary.style_rules.length,
    }),
    [glossary]
  )

  const handleSave = async () => {
    if (!formData.source.trim() || !formData.target.trim()) {
      toast({
        title: 'Missing required fields',
        description: 'Source and target terms are required.',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)

    try {
      const updated = await addGlossaryTerm({
        ...formData,
        domain: formData.domain?.trim() || null,
        notes: formData.notes?.trim() || null,
      })

      setGlossary(updated)
      setDialogOpen(false)
      setFormData(EMPTY_TERM)
      toast({
        title: 'Glossary updated',
        description: `Saved ${formData.source} -> ${formData.target}.`,
      })
    } catch {
      toast({
        title: 'Save failed',
        description: 'The glossary term could not be stored by the backend.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell
      title="Glossary"
      subtitle="Keep terminology and writing guidance consistent across every document review."
      actions={
        <Button className="rounded-2xl" onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Term
        </Button>
      }
    >
      <div className="space-y-6">
        <section className="hero-sheen overflow-hidden rounded-[2rem] border border-border/70">
          <div className="grid gap-4 px-6 py-7 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Terminology control</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                Give translators and reviewers one clean source of truth.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
                Use approved terms and style rules to reduce inconsistency, protect domain language, and keep the
                translation workflow aligned from the first draft through final export.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: 'Terms', value: stats.termCount, icon: BookOpen },
                { label: 'Languages', value: stats.languageCount, icon: Globe2 },
                { label: 'Domains', value: stats.domainCount, icon: Tag },
                { label: 'Style rules', value: stats.rulesCount, icon: Sparkles },
              ].map((item) => (
                <Card key={item.label} className="rounded-[1.5rem] border-border/60 bg-background/75 p-4">
                  <item.icon className="h-4 w-4 text-primary" />
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{loading ? '-' : item.value}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <Card className="glass-panel rounded-[1.75rem] p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search terms, targets, domains, or notes..."
                  className="h-11 rounded-2xl border-border/70 pl-10"
                />
              </div>
            </Card>

            {loading ? (
              <div className="glass-panel flex flex-col items-center gap-4 rounded-[2rem] py-24">
                <Spinner className="h-8 w-8 text-primary" />
                <p className="text-sm text-muted-foreground">Loading glossary...</p>
              </div>
            ) : filteredTerms.length === 0 ? (
              <Card className="glass-panel flex flex-col items-center gap-3 rounded-[2rem] py-20 text-center">
                <BookOpen className="h-10 w-10 text-muted-foreground/50" />
                <p className="text-lg font-semibold text-foreground">No matching terms</p>
                <p className="max-w-md text-sm leading-7 text-muted-foreground">
                  Add approved language for your domain so reviewers and translators can stay aligned.
                </p>
              </Card>
            ) : (
              <div className="grid gap-4">
                {filteredTerms.map((term, index) => (
                  <Card key={`${term.source}-${term.language}-${index}`} className="glass-panel rounded-[1.75rem] p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-semibold text-foreground">{term.source}</p>
                          <span className="text-sm text-muted-foreground">{'->'}</span>
                          <p className="text-lg font-semibold text-primary">{term.target}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-border bg-background/80 px-2.5 py-1 text-[11px] font-mono uppercase text-muted-foreground">
                            {term.language}
                          </span>
                          {term.domain ? <DomainChip domain={term.domain} /> : null}
                        </div>
                      </div>

                      {term.notes ? (
                        <div className="max-w-md rounded-[1.25rem] border border-border/60 bg-background/70 px-4 py-3 text-sm leading-7 text-muted-foreground">
                          {term.notes}
                        </div>
                      ) : null}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <Card className="glass-panel rounded-[1.75rem] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Style rules</p>
              <div className="mt-4 space-y-3">
                {glossary.style_rules.length > 0 ? (
                  glossary.style_rules.map((rule, index) => (
                    <div key={`${rule}-${index}`} className="rounded-[1.25rem] border border-border/60 bg-background/75 px-4 py-3 text-sm leading-7 text-muted-foreground">
                      {rule}
                    </div>
                  ))
                ) : (
                  <p className="text-sm leading-7 text-muted-foreground">
                    No backend style rules are configured yet. Added rules will appear here when the API returns them.
                  </p>
                )}
              </div>
            </Card>

            <Card className="glass-panel rounded-[1.75rem] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">How updates work</p>
              <div className="mt-4 space-y-3 text-sm leading-7 text-muted-foreground">
                <p>The backend supports adding or updating terms through the same glossary save endpoint.</p>
                <p>There is no supported delete endpoint, so this screen stays honest to the current backend contract.</p>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-[2rem] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add or update a glossary term</DialogTitle>
            <DialogDescription>
              Save approved terminology so machine drafts and reviewers stay aligned.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="source">Source term</Label>
                <Input
                  id="source"
                  value={formData.source}
                  onChange={(event) => setFormData((prev) => ({ ...prev, source: event.target.value }))}
                  className="rounded-2xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="target">Target term</Label>
                <Input
                  id="target"
                  value={formData.target}
                  onChange={(event) => setFormData((prev) => ({ ...prev, target: event.target.value }))}
                  className="rounded-2xl"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="language">Language</Label>
                <Input
                  id="language"
                  value={formData.language}
                  onChange={(event) => setFormData((prev) => ({ ...prev, language: event.target.value }))}
                  className="rounded-2xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  value={formData.domain ?? ''}
                  onChange={(event) => setFormData((prev) => ({ ...prev, domain: event.target.value }))}
                  className="rounded-2xl"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes ?? ''}
                onChange={(event) => setFormData((prev) => ({ ...prev, notes: event.target.value }))}
                className="min-h-28 rounded-2xl"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="rounded-2xl" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button className="rounded-2xl" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
              Save term
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
