'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, File, CheckCircle2, AlertCircle, X, ArrowRight, ShieldCheck } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { uploadDocument } from '@/lib/api'
import { cn } from '@/lib/utils'

type UploadState = 'idle' | 'dragging' | 'uploading' | 'success' | 'error'

const ACCEPTED_TYPES = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export default function UploadPage() {
  const router = useRouter()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [uploadResult, setUploadResult] = useState<{
    document_id: string
    blocks_parsed: number
    filename: string
  } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const validateFile = (file: File): string | null => {
    if (!Object.keys(ACCEPTED_TYPES).includes(file.type)) {
      return 'Only PDF and DOCX files are supported.'
    }
    if (file.size > 50 * 1024 * 1024) {
      return 'File size must be under 50 MB.'
    }
    return null
  }

  const handleFile = (file: File) => {
    const err = validateFile(file)
    if (err) {
      toast({ title: 'Invalid file', description: err, variant: 'destructive' })
      return
    }
    setSelectedFile(file)
    setUploadState('idle')
    setErrorMsg('')
    setUploadResult(null)
    setProgress(0)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setUploadState('idle')
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setUploadState('dragging')
  }

  const onDragLeave = () => setUploadState('idle')

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    setUploadState('uploading')
    setProgress(0)

    try {
      const fakeInterval = setInterval(() => {
        setProgress((p) => (p < 60 ? p + 8 : p))
      }, 200)

      const result = await uploadDocument(selectedFile, (p) => setProgress(p))
      clearInterval(fakeInterval)
      setProgress(100)
      setUploadResult(result)
      setUploadState('success')
      toast({ title: 'Upload successful', description: `${result.blocks_parsed} blocks parsed.` })
      router.push(`/validate?doc=${result.document_id}`)
      router.refresh()
    } catch {
      setUploadState('error')
      const msg =
        'Failed to upload document. Make sure the backend is running and NEXT_PUBLIC_API_URL is configured correctly.'
      setErrorMsg(msg)
      toast({
        title: 'Upload failed',
        description: msg,
        variant: 'destructive',
      })
    }
  }

  const handleProceed = () => {
    if (uploadResult) {
      router.push(`/validate?doc=${uploadResult.document_id}`)
    }
  }

  const reset = () => {
    setSelectedFile(null)
    setUploadState('idle')
    setProgress(0)
    setUploadResult(null)
    setErrorMsg('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const fileIcon = selectedFile?.type === 'application/pdf' ? FileText : File

  return (
    <AppShell
      title="Upload A New Document"
      subtitle="Bring in a PDF or DOCX and move straight into validation, translation, and reviewer approval."
    >
      <div className="space-y-6">
        <section className="hero-sheen overflow-hidden rounded-[1.75rem] border border-border/70">
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end lg:px-8">
            <div className="space-y-4">
              <Badge className="w-fit rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold tracking-[0.2em] text-foreground backdrop-blur">
                Ready to ingest
              </Badge>
              <div className="space-y-3">
                <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                  Start with one clean upload.
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
                  Drop in a PDF or DOCX, preserve structure, and move straight into validation and translation without extra setup.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {['PDF and DOCX support', 'Structure-aware parsing', 'Up to 50 MB per file'].map((item) => (
                  <Badge
                    key={item}
                    variant="outline"
                    className="rounded-full border-border/70 bg-background/55 px-3 py-1 text-xs text-muted-foreground backdrop-blur"
                  >
                    {item}
                  </Badge>
                ))}
              </div>
            </div>

            <Card className="rounded-[1.5rem] border-white/20 bg-white/10 p-5 backdrop-blur">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Before you upload
                  </p>
                  <p className="mt-2 text-sm leading-7 text-foreground">
                    Best results come from text-based PDFs and clean DOCX files with stable headings and tables.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card
            className={cn(
              'relative flex min-h-[24rem] flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed p-6 text-center transition-all duration-200 sm:p-8',
              uploadState === 'dragging'
                ? 'border-primary bg-primary/8 scale-[1.01]'
                : uploadState === 'success'
                ? 'border-green-400 bg-[var(--status-exact-bg)]'
                : uploadState === 'error'
                ? 'border-destructive bg-[var(--status-new-bg)]'
                : 'glass-panel hover:border-primary/50 hover:bg-accent/20'
            )}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => !selectedFile && inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={onInputChange}
            />

            {uploadState === 'success' ? (
              <CheckCircle2 className="mb-4 h-14 w-14 text-[var(--status-exact)]" />
            ) : uploadState === 'error' ? (
              <AlertCircle className="mb-4 h-14 w-14 text-destructive" />
            ) : (
              <div
                className={cn(
                  'mb-5 flex h-20 w-20 items-center justify-center rounded-[1.75rem] transition-colors',
                  uploadState === 'dragging' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                <Upload className="h-8 w-8" />
              </div>
            )}

            {uploadState === 'error' && errorMsg && <p className="mt-2 max-w-xs text-sm text-destructive">{errorMsg}</p>}

            {!selectedFile ? (
              <>
                <p className="text-lg font-semibold text-foreground">
                  {uploadState === 'dragging' ? 'Drop to upload' : 'Drag and drop your source file here'}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  or <span className="font-medium text-primary">browse from your device</span>
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {['PDF', 'DOCX'].map((f) => (
                    <Badge key={f} variant="secondary" className="rounded-full font-mono text-xs">
                      .{f.toLowerCase()}
                    </Badge>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                    {(() => {
                      const Icon = fileIcon
                      return <Icon className="h-5 w-5 text-primary" />
                    })()}
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-foreground">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(selectedFile.size)}</p>
                  </div>
                  {uploadState !== 'uploading' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        reset()
                      }}
                      className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {uploadState === 'uploading' && (
                  <div className="w-full max-w-sm space-y-2">
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-muted-foreground">{progress}% uploaded</p>
                  </div>
                )}

                {uploadState === 'success' && uploadResult && (
                  <div className="text-center">
                    <p className="text-sm font-medium text-[var(--status-exact)]">Upload complete</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {uploadResult.blocks_parsed} blocks parsed | ID: {uploadResult.document_id.slice(0, 12)}...
                    </p>
                  </div>
                )}
              </>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="glass-panel rounded-[1.5rem] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Workflow</p>
                <Badge variant="outline" className="rounded-full text-[10px] font-semibold uppercase tracking-[0.16em]">
                  4 steps
                </Badge>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  'Upload the source file',
                  'Validate the extracted text',
                  'Generate the target-language draft',
                  'Review and approve final segments',
                ].map((step, i) => (
                  <div key={step} className="flex items-start gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary">
                      {i + 1}
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">{step}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="glass-panel rounded-[1.5rem] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Actions</p>
              <div className="mt-4 flex flex-col gap-3">
                {selectedFile && uploadState !== 'uploading' && uploadState !== 'success' && (
                  <Button onClick={handleUpload} className="h-11 rounded-xl">
                    <Upload className="mr-2 h-4 w-4" />
                    Upload and parse
                  </Button>
                )}

                {uploadState === 'success' && (
                  <>
                    <Button variant="outline" onClick={reset} className="h-11 rounded-xl">
                      Upload Another
                    </Button>
                    <Button onClick={handleProceed} className="h-11 rounded-xl">
                      Validate Document
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </>
                )}

                {!selectedFile && (
                  <Button
                    variant="outline"
                    className="h-11 rounded-xl"
                    onClick={() => inputRef.current?.click()}
                  >
                    <File className="mr-2 h-4 w-4" />
                    Browse Files
                  </Button>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
