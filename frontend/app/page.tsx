'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, File, CheckCircle2, AlertCircle, X, ArrowRight } from 'lucide-react'
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
      // Simulate initial progress for UX feel
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
    } catch (err) {
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
      title="Upload Document"
      subtitle="Import a PDF or DOCX file to begin the translation workflow"
    >
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Supported formats', value: 'PDF, DOCX' },
            { label: 'Max file size', value: '50 MB' },
            { label: 'Processing speed', value: '~3s / page' },
          ].map((s) => (
            <Card key={s.label} className="p-4 text-center">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{s.value}</p>
            </Card>
          ))}
        </div>

        {/* Drop zone */}
        <Card
          className={cn(
            'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-200 cursor-pointer',
            uploadState === 'dragging'
              ? 'border-primary bg-accent scale-[1.01]'
              : uploadState === 'success'
              ? 'border-green-400 bg-[var(--status-exact-bg)]'
              : uploadState === 'error'
              ? 'border-destructive bg-[var(--status-new-bg)]'
              : 'border-border bg-card hover:border-primary/50 hover:bg-accent/30'
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
            <CheckCircle2 className="h-12 w-12 text-[var(--status-exact)] mb-4" />
          ) : uploadState === 'error' ? (
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          ) : (
            <div
              className={cn(
                'mb-4 flex h-16 w-16 items-center justify-center rounded-2xl transition-colors',
                uploadState === 'dragging' ? 'bg-primary' : 'bg-muted'
              )}
            >
              <Upload
                className={cn(
                  'h-7 w-7 transition-colors',
                  uploadState === 'dragging' ? 'text-primary-foreground' : 'text-muted-foreground'
                )}
              />
            </div>
          )}

          {uploadState === 'error' && errorMsg && (
            <p className="mt-2 text-sm text-destructive max-w-xs">{errorMsg}</p>
          )}

          {!selectedFile ? (
            <>
              <p className="text-base font-semibold text-foreground">
                {uploadState === 'dragging' ? 'Drop to upload' : 'Drag & drop your file here'}
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                or{' '}
                <span className="text-primary underline-offset-2 hover:underline cursor-pointer">
                  browse files
                </span>
              </p>
              <div className="mt-4 flex gap-2">
                {['PDF', 'DOCX'].map((f) => (
                  <Badge key={f} variant="secondary" className="font-mono text-xs">
                    .{f.toLowerCase()}
                  </Badge>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
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
                    onClick={(e) => { e.stopPropagation(); reset() }}
                    className="ml-2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {uploadState === 'uploading' && (
                <div className="w-full max-w-xs space-y-1.5">
                  <Progress value={progress} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">{progress}% uploaded</p>
                </div>
              )}

              {uploadState === 'success' && uploadResult && (
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--status-exact)]">
                    Upload complete
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {uploadResult.blocks_parsed} blocks parsed | ID: {uploadResult.document_id.slice(0, 12)}...
                  </p>
                </div>
              )}
            </>
          )}
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          {selectedFile && uploadState !== 'uploading' && uploadState !== 'success' && (
            <Button onClick={handleUpload} className="rounded-xl px-6">
              <Upload className="mr-2 h-4 w-4" />
              Upload & Parse
            </Button>
          )}

          {uploadState === 'success' && (
            <>
              <Button variant="outline" onClick={reset} className="rounded-xl">
                Upload Another
              </Button>
              <Button onClick={handleProceed} className="rounded-xl px-6">
                Validate Document
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          )}

          {!selectedFile && (
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => inputRef.current?.click()}
            >
              <File className="mr-2 h-4 w-4" />
              Browse Files
            </Button>
          )}
        </div>

        {/* Instructions */}
        <Card className="p-5 rounded-2xl bg-accent/40 border-accent">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            How it works
          </p>
          <div className="space-y-2.5">
            {[
              'Upload your PDF or DOCX source document',
              'Validate spelling, grammar, and consistency',
              'Translate into your target language',
              'Review, edit, and approve segments with TM support',
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                  {i + 1}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{step}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
