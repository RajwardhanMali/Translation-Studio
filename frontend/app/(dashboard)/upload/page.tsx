'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Upload, FileText, File, CheckCircle2, AlertCircle, X, ArrowRight, ShieldCheck, Zap, CloudLightning, Shield, Activity, Sparkles, RefreshCw } from 'lucide-react'
import { Reveal } from '@/components/motion/primitives'
import { LayoutHeader } from '@/components/layout-context'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { registerDocumentOwner, uploadDocument } from '@/lib/api'
import { useDashboardStore } from '@/store/use-dashboard-store'
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

      const result = await uploadDocument(selectedFile, (p: number) => setProgress(p))
      try {
        await registerDocumentOwner(result.document_id)
      } catch {
        toast({
          title: 'Ownership setup delayed',
          description: 'The document uploaded successfully, but collaborator ownership could not be registered yet.',
          variant: 'destructive',
        })
      }
      clearInterval(fakeInterval)
      setProgress(100)
      setUploadResult(result)
      setUploadState('success')
      toast({ title: 'Upload successful', description: `${result.blocks_parsed} blocks parsed.` })
      
      // Invalidate dashboard cache so new document appears without refresh
      const { fetchDocuments } = useDashboardStore.getState()
      void fetchDocuments(true)
      
      router.push(`/validate?doc=${result.document_id}`)
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
    <>
      <LayoutHeader
        title="Upload A New Document"
        subtitle="Bring in a PDF or DOCX and move straight into validation, translation, and reviewer approval."
      />
      <div className="relative space-y-8">
        {/* Visual Polish: Background Spotlight */}
        <div className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-[600px] w-[1000px] -translate-x-1/2 opacity-25 blur-[140px] dark:opacity-15">
          <div className="h-full w-full bg-gradient-to-br from-primary/30 via-emerald-500/20 to-blue-600/30" />
        </div>

        {/* Streamlined Hero Section: All-in-One Upload Experience */}
        <Reveal className="hero-sheen overflow-hidden rounded-[2.5rem] border border-border/60 bg-background/20 backdrop-blur-sm">
          <div className="grid gap-10 px-6 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-10 lg:py-10">
            {/* Left Column: Title and Upload Core */}
            <div className="space-y-8">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                    Injest Pipeline
                  </Badge>
                  <div className="h-px w-8 bg-border/60" />
                  <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">Source Preparation</span>
                </div>
                <h2 className="mt-5 text-4xl font-bold tracking-tight text-foreground md:text-5xl">
                  Start with a <span className="text-primary italic">clean</span> upload.
                </h2>
              </div>
              
              {/* Compact Glass Dropzone Integrated into Hero */}
              <Card
                className={cn(
                  'relative flex min-h-[16rem] flex-col items-center justify-center rounded-[2rem] border-2 border-dashed p-6 text-center transition-all duration-500 ease-out sm:p-8',
                  uploadState === 'dragging'
                    ? 'border-primary bg-primary/10 scale-[1.02] shadow-2xl shadow-primary/20'
                    : uploadState === 'success'
                    ? 'border-emerald-400 bg-emerald-500/5'
                    : uploadState === 'error'
                    ? 'border-destructive/50 bg-destructive/5'
                    : 'glass-panel border-border/40 bg-background/40 backdrop-blur-md hover:border-primary/50 hover:bg-accent/10 active:scale-[0.98]'
                )}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => !selectedFile && inputRef.current?.click()}
              >
                {/* Pulsing dragging state decoration */}
                {uploadState === 'dragging' && (
                  <div className="absolute inset-4 rounded-[1.75rem] border-2 border-primary/20 animate-pulse" />
                )}

                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={onInputChange}
                />

                {!selectedFile ? (
                  <>
                    <div className={cn(
                      'mb-4 flex h-16 w-16 items-center justify-center rounded-2xl transition-colors',
                      uploadState === 'dragging' ? 'bg-primary text-primary-foreground shadow-lg' : 'bg-muted/80 text-muted-foreground'
                    )}>
                      <Upload className="h-7 w-7" />
                    </div>
                    <p className="text-base font-semibold text-foreground">
                      {uploadState === 'dragging' ? 'Drop to upload' : 'Drag and drop your file here'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      or <span className="font-medium text-primary">browse from your device</span>
                    </p>
                    <div className="mt-4 flex gap-2">
                       <Badge variant="outline" className="rounded-full text-[10px] bg-background/50">PDF</Badge>
                       <Badge variant="outline" className="rounded-full text-[10px] bg-background/50">DOCX</Badge>
                    </div>
                  </>
                ) : (
                  <div className="w-full">
                    <div className="mb-4 flex items-center justify-center gap-4">
                      {uploadState === 'success' ? (
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
                          <CheckCircle2 className="h-6 w-6" />
                        </div>
                      ) : uploadState === 'error' ? (
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                          <AlertCircle className="h-6 w-6" />
                        </div>
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          {(() => {
                            const Icon = fileIcon
                            return <Icon className="h-6 w-6" />
                          })()}
                        </div>
                      )}
                      <div className="text-left">
                        <p className="max-w-[180px] truncate text-sm font-semibold text-foreground">{selectedFile.name}</p>
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
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {uploadState === 'uploading' ? (
                      <div className="mx-auto w-full max-w-[240px] space-y-2">
                        <Progress value={progress} className="h-1.5" />
                        <p className="text-[10px] font-medium text-muted-foreground">{progress}% uploaded</p>
                      </div>
                    ) : uploadState === 'success' ? (
                      <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 py-1 font-semibold">Ready for validation</Badge>
                    ) : uploadState === 'error' ? (
                       <p className="max-w-[200px] mx-auto text-[10px] text-destructive leading-relaxed">{errorMsg || "Upload failed. Please try again."}</p>
                    ) : (
                      <Button onClick={(e) => { e.stopPropagation(); handleUpload(); }} className="h-10 rounded-xl bg-primary px-6 shadow-lg shadow-primary/20">
                        Upload & Parse
                      </Button>
                    )}
                  </div>
                )}
              </Card>

              {uploadState === 'success' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                   <Button onClick={handleProceed} className="h-12 flex-1 rounded-2xl bg-primary text-base font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30">
                    Validate Now
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                  <Button variant="outline" onClick={reset} className="h-12 rounded-2xl border-border/50 bg-background/40 font-medium hover:bg-accent/50">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </motion.div>
              )}
            </div>

            {/* Right Column: Workflow Overview */}
            <div className="flex flex-col justify-center">
              <Card className="glass-panel border-border/50 rounded-[2.25rem] bg-background/40 p-6 shadow-2xl backdrop-blur-md md:p-8">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground/60">Preparation Workflow</p>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">4</div>
                </div>
                <div className="mt-8 space-y-7 relative">
                  {/* Connecting Line */}
                  <div className="absolute left-[13px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-primary/40 via-primary/10 to-transparent" />
                  
                  {[
                    { title: 'Upload source file', desc: 'Secure transmission to storage' },
                    { title: 'Validate extracted text', desc: 'Ensure parser accuracy' },
                    { title: 'Generate draft', desc: 'Neural translation memory' },
                    { title: 'Review & approve', desc: 'Final segment confirmation' },
                  ].map((step, i) => (
                    <div key={step.title} className="relative flex items-start gap-5">
                      <div className={cn(
                        "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-all duration-500",
                        uploadState === 'success' && i === 0 
                          ? "border-emerald-500/50 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" 
                          : "border-primary/20 bg-background/80 text-primary/60"
                      )}>
                        {uploadState === 'success' && i === 0 ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                      </div>
                      <div className="space-y-1 pt-0.5">
                        <p className="text-sm font-semibold text-foreground tracking-tight">{step.title}</p>
                        <p className="text-[11px] leading-relaxed text-muted-foreground/80">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </Reveal>
      </div>
    </>
  )
}
