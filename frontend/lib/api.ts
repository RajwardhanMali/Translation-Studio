import axios from 'axios'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
})

export interface UploadResponse {
  document_id: string
  filename: string
  file_type: 'pdf' | 'docx'
  blocks_parsed: number
  message: string
}

export interface DocumentSummary {
  id: string
  filename: string
  file_type: 'pdf' | 'docx'
  created_at: string
  blocks_count: number
  segments: {
    total: number
    pending: number
    reviewed: number
    approved: number
  }
  translation_progress: number
}

export interface ValidationIssue {
  issue_type: string
  issue: string
  suggestion: string
  severity: 'error' | 'warning' | 'info'
}

export interface ValidationResult {
  segment_id?: string
  text: string
  issues: ValidationIssue[]
  auto_fixed_text?: string
  has_errors: boolean
  has_warnings: boolean
}

export interface TMSuggestion {
  text: string
  score: number
}

export interface SegmentFormatSnapshot {
  level?: number
  [key: string]: unknown
}

export interface Segment {
  segment_id: string
  source_text: string
  translated_text: string
  final_text?: string
  status: 'pending' | 'reviewed' | 'approved' | 'skip' | string
  type: 'sentence' | 'heading' | 'table_cell' | 'spacer' | 'table_start' | 'table_end' | 'image' | 'header_footer' | string
  tm_match_type?: 'exact' | 'fuzzy' | 'new' | null
  tm_suggestions?: TMSuggestion[]
  glossary_violations?: string[]
  format_snapshot?: SegmentFormatSnapshot | null
  row?: number | null
  col?: number | null
}

export interface GlossaryTerm {
  id?: string
  source: string
  target: string
  language: string
  domain?: string | null
  notes?: string | null
}

export interface GlossaryResponse {
  terms: GlossaryTerm[]
  style_rules: string[]
}

export interface ApproveResponse {
  segment_id: string
  status: string
  final_text: string
}

export interface TranslateResponse {
  document_id?: string
  segments_translated: number
  results?: Segment[]
}

export interface TranslateInfoResponse {
  backend: 'groq' | 'ollama' | string
  model: string
  key_set?: boolean
  host?: string
}

export interface ExportStatusResponse {
  total_segments: number
  pending: number
  reviewed: number
  approved: number
  translation_errors: number
  progress_percent: number
  ready_to_export: boolean
  warning: string | null
}

export type ExportFormat = 'same' | 'docx' | 'pdf'

export interface ShareRecipient {
  clerkUserId: string
  email: string
  name: string | null
  accessedAt: string
}

export interface ShareOverviewResponse {
  ownedByDocument: Record<
    string,
    {
      shareId: string
      shareUrl: string
      recipients: ShareRecipient[]
    }
  >
  receivedDocumentIds: string[]
}

export async function uploadDocument(
  file: File,
  onUploadProgress?: (progress: number) => void
): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await apiClient.post<UploadResponse>('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total) onUploadProgress?.(Math.round((e.loaded * 100) / e.total))
    },
  })
  return res.data
}

export async function getDocument(id: string) {
  const res = await apiClient.get(`/document/${id}`)
  return res.data
}

export async function getDocuments(): Promise<DocumentSummary[]> {
  const res = await apiClient.get<DocumentSummary[]>('/documents')
  return res.data
}

export async function deleteDocument(id: string): Promise<void> {
  await apiClient.delete(`/document/${id}`)
}

export async function validateDocument(documentId: string, autoFix = false): Promise<ValidationResult[]> {
  const res = await apiClient.post<ValidationResult[]>('/validate', {
    document_id: documentId,
    auto_fix: autoFix,
  })
  return res.data
}

export async function translateDocument(
  documentId: string,
  targetLanguage: string,
  styleRules?: string[],
  segmentIds?: string[]
): Promise<TranslateResponse> {
  const res = await apiClient.post<TranslateResponse>(
    '/translate',
    {
      document_id: documentId,
      target_language: targetLanguage,
      style_rules: styleRules,
      segment_ids: segmentIds,
    },
    {
      timeout: 300000,
    }
  )
  return res.data
}

export async function getSegments(docId: string, status?: string, type?: string): Promise<Segment[]> {
  const res = await apiClient.get<Segment[]>(`/segments/${docId}`, {
    params: { status, type },
  })
  return res.data
}

export async function approveSegment(segmentId: string, approved: boolean, correction?: string): Promise<ApproveResponse> {
  const res = await apiClient.post<ApproveResponse>('/approve', {
    segment_id: segmentId,
    approved,
    correction,
  })
  return res.data
}

export async function getGlossary(): Promise<GlossaryResponse> {
  const res = await apiClient.get<GlossaryResponse>('/glossary')
  return res.data
}

export async function addGlossaryTerm(term: GlossaryTerm): Promise<GlossaryResponse> {
  const res = await apiClient.post<GlossaryResponse>('/glossary', { term })
  return res.data
}

export async function checkHealth(): Promise<{ status: string }> {
  const res = await apiClient.get<{ status: string }>('/health')
  return res.data
}

export async function getTranslateInfo(): Promise<TranslateInfoResponse> {
  const res = await apiClient.get<TranslateInfoResponse>('/translate/info')
  return res.data
}

export async function getExportStatus(documentId: string): Promise<ExportStatusResponse> {
  const res = await apiClient.get<ExportStatusResponse>(`/export/status/${documentId}`)
  return res.data
}

export async function downloadExport(documentId: string, format: ExportFormat): Promise<string> {
  const response = await apiClient.post<Blob>(`/export/${documentId}?format=${format}`, undefined, {
    responseType: 'blob',
    timeout: 120000,
  })

  const blob = response.data
  const url = URL.createObjectURL(blob)
  const disposition =
    typeof response.headers['content-disposition'] === 'string' ? response.headers['content-disposition'] : ''
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/)
  const filename = match?.[1] ?? `translation.${format === 'same' ? 'docx' : format}`

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)

  return filename
}

export async function createShareLink(documentId: string): Promise<{ shareId: string; shareUrl: string }> {
  const response = await fetch('/api/shares', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ documentId }),
  })

  if (!response.ok) {
    throw new Error('Failed to create share link.')
  }

  return response.json()
}

export async function getShareOverview(): Promise<ShareOverviewResponse> {
  const response = await fetch('/api/shares', {
    method: 'GET',
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('Failed to load share overview.')
  }

  return response.json()
}
