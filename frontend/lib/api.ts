import axios from "axios";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const NORMALIZED_BASE_URL = BASE_URL.replace(/\/+$/, "");
let backendAuthUserId: string | null = null;

function buildApiUrl(path: string) {
  return `${NORMALIZED_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
});

export function setBackendAuthUserId(userId: string | null) {
  backendAuthUserId = userId;

  if (userId) {
    apiClient.defaults.headers.common["X-Clerk-User-Id"] = userId;
  } else {
    delete apiClient.defaults.headers.common["X-Clerk-User-Id"];
  }
}

type StreamEventHandler<T> = (event: T) => void;

export interface UploadResponse {
  document_id: string;
  filename: string;
  file_type: "pdf" | "docx";
  blocks_parsed: number;
  message: string;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  file_type: "pdf" | "docx";
  created_at: string;
  blocks_count: number;
  segments: {
    total: number;
    pending: number;
    reviewed: number;
    approved: number;
  };
  translation_progress: number;
  owner_clerk_user_id?: string | null;
  access_role?: CollaboratorRole | null;
  is_owner?: boolean;
}

export interface ValidationIssue {
  segment_id?: string;
  issue_type: string;
  issue: string;
  suggestion: string;
  severity: "error" | "warning" | "info";
  span?: string | null;
  offset?: number | null;
  length?: number | null;
  confidence?: number | null;
  source?: string | null;
}

export interface ValidationResult {
  document_id?: string;
  segment_id?: string;
  text: string;
  issues: ValidationIssue[];
  auto_fixed_text?: string;
  has_errors: boolean;
  has_warnings: boolean;
}

export type ValidationStreamEvent =
  | {
      type: "start";
      document_id: string;
      total_segments: number;
    }
  | {
      type: "segment";
      document_id: string;
      segment_id?: string;
      index: number;
      result: ValidationResult;
    }
  | {
      type: "progress";
      document_id: string;
      completed: number;
      total: number;
      invalid_segments: number;
    }
  | {
      type: "complete";
      document_id: string;
      completed: number;
      total: number;
      invalid_segments: number;
    }
  | {
      type: "error";
      document_id?: string;
      segment_id?: string;
      message: string;
    };

export interface ValidationAppliedFix {
  segment_id: string;
  original: string;
  fixed: string;
  issues_fixed: number;
}

export interface ApplyFixesResponse {
  document_id: string;
  fixed_count: number;
  fixes: ValidationAppliedFix[];
}

export interface EditSegmentResponse {
  segment_id: string;
  old_text: string;
  new_text: string;
  status: string;
}

export interface TMSuggestion {
  text: string;
  score: number;
}

export interface SegmentFormatSnapshot {
  level?: number;
  [key: string]: unknown;
}

export interface Segment {
  segment_id: string;
  source_text: string;
  translated_text: string;
  final_text?: string;
  status: "pending" | "reviewed" | "approved" | "skip" | string;
  type:
    | "sentence"
    | "heading"
    | "table_cell"
    | "spacer"
    | "table_start"
    | "table_end"
    | "image"
    | "header_footer"
    | string;
  tm_match_type?: "exact" | "fuzzy" | "new" | null;
  tm_suggestions?: TMSuggestion[];
  glossary_violations?: string[];
  format_snapshot?: SegmentFormatSnapshot | null;
  row?: number | null;
  col?: number | null;
  assigned_to_clerk_user_id?: string | null;
  assigned_to_name?: string | null;
  assigned_to_email?: string | null;
  locked_by_clerk_user_id?: string | null;
  locked_by_name?: string | null;
  locked_by_email?: string | null;
  lock_expires_at?: string | null;
}

export interface GlossaryTerm {
  id?: string;
  source: string;
  target: string;
  language: string;
  domain?: string | null;
  notes?: string | null;
}

export interface GlossaryResponse {
  terms: GlossaryTerm[];
  style_rules: string[];
}

export interface ApproveResponse {
  segment_id: string;
  status: string;
  final_text: string;
}

export interface TranslateResponse {
  document_id?: string;
  segments_translated: number;
  segments?: Segment[];
}

export type TranslationStreamEvent =
  | {
      type: "start";
      document_id: string;
      target_language: string;
      total_segments: number;
    }
  | {
      type: "segment";
      document_id: string;
      segment_id: string;
      index: number;
      batch: number;
      total_batches: number;
      segment: Record<string, unknown>;
    }
  | {
      type: "progress";
      document_id: string;
      completed: number;
      total: number;
      translated: number;
    }
  | {
      type: "complete";
      document_id: string;
      completed: number;
      total: number;
      translated: number;
    }
  | {
      type: "error";
      document_id?: string;
      segment_id?: string;
      message: string;
    };

async function streamNdjson<T>(
  path: string,
  body: Record<string, unknown>,
  onEvent: StreamEventHandler<T>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(buildApiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(backendAuthUserId ? { "X-Clerk-User-Id": backendAuthUserId } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Streaming request failed with status ${response.status}.`);
  }

  if (!response.body) {
    throw new Error("Streaming response did not include a readable body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      onEvent(JSON.parse(trimmed) as T);
    }
  }

  const finalChunk = buffer.trim();
  if (finalChunk) {
    onEvent(JSON.parse(finalChunk) as T);
  }
}

export interface TranslateInfoResponse {
  backend: "groq" | "ollama" | string;
  model: string;
  key_set?: boolean;
  host?: string;
}

export interface ExportStatusResponse {
  total_segments: number;
  pending: number;
  reviewed: number;
  approved: number;
  translation_errors: number;
  progress_percent: number;
  ready_to_export: boolean;
  warning: string | null;
}

export type ExportFormat = "same" | "docx" | "pdf";

export interface ShareRecipient {
  clerkUserId: string;
  email: string;
  name: string | null;
  accessedAt: string;
}

export interface ShareParticipant extends ShareRecipient {
  role: "owner" | "recipient";
}

export type CollaboratorRole = "owner" | "editor" | "viewer";

export interface DocumentCollaborator {
  id: string;
  documentId: string;
  collaboratorClerkUserId: string;
  collaboratorEmail: string;
  collaboratorName: string | null;
  role: CollaboratorRole;
  addedByClerkUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentCollaboratorsResponse {
  documentId: string;
  currentRole: CollaboratorRole;
  collaborators: DocumentCollaborator[];
}

export interface DocumentPresenceUser {
  id: string;
  documentId: string;
  collaboratorClerkUserId: string;
  collaboratorEmail: string;
  collaboratorName: string | null;
  role: CollaboratorRole;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentPresenceResponse {
  documentId: string;
  currentRole: CollaboratorRole;
  activeUsers: DocumentPresenceUser[];
}

export interface CollaborationAssignment {
  segment_id: string;
  document_id: string;
  assigned_to_clerk_user_id: string;
  assigned_to_email: string;
  assigned_to_name?: string | null;
  assigned_by_clerk_user_id: string;
  updated_at?: string | null;
}

export interface CollaborationLock {
  segment_id: string;
  document_id: string;
  locked_by_clerk_user_id: string;
  locked_by_email: string;
  locked_by_name?: string | null;
  expires_at: string;
  updated_at?: string | null;
}

export interface BackendDocumentCollaborator {
  document_id: string;
  collaborator_clerk_user_id: string;
  collaborator_email: string;
  collaborator_name?: string | null;
  role: CollaboratorRole;
}

export interface CollaborationStateResponse {
  document_id: string;
  current_role: CollaboratorRole;
  collaborators: BackendDocumentCollaborator[];
  assignments: CollaborationAssignment[];
  active_locks: CollaborationLock[];
}

export interface ShareOverviewResponse {
  ownedByDocument: Record<
    string,
    {
      shareId: string;
      shareUrl: string;
      recipients: ShareRecipient[];
    }
  >;
  visibleByDocument: Record<
    string,
    {
      shareId: string;
      shareUrl: string;
      participants: ShareParticipant[];
    }
  >;
  receivedDocumentIds: string[];
}

export async function uploadDocument(
  file: File,
  onUploadProgress?: (progress: number) => void,
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiClient.post<UploadResponse>("/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 0,
    onUploadProgress: (e) => {
      if (e.total) onUploadProgress?.(Math.round((e.loaded * 100) / e.total));
    },
  });
  return res.data;
}

export async function getDocument(id: string) {
  const res = await apiClient.get(`/document/${id}`);
  return res.data;
}

export async function getDocuments(): Promise<DocumentSummary[]> {
  const res = await apiClient.get<DocumentSummary[]>("/documents");
  return res.data;
}

export async function deleteDocument(id: string): Promise<void> {
  await apiClient.delete(`/document/${id}`);
}

export async function validateDocument(
  documentId: string,
  autoFix = false,
): Promise<ValidationResult[]> {
  const res = await apiClient.post<ValidationResult[]>("/validate", {
    document_id: documentId,
    auto_fix: autoFix,
  }, {
    timeout: 0,
  });
  return res.data;
}

export async function streamValidateDocument(
  documentId: string,
  autoFix: boolean,
  onEvent: StreamEventHandler<ValidationStreamEvent>,
  signal?: AbortSignal,
): Promise<void> {
  await streamNdjson<ValidationStreamEvent>(
    "/validate/stream",
    {
      document_id: documentId,
      auto_fix: autoFix,
    },
    onEvent,
    signal,
  );
}

export async function applyValidationFixes(
  documentId: string,
  segmentIds?: string[],
): Promise<ApplyFixesResponse> {
  const res = await apiClient.post<ApplyFixesResponse>(
    "/validate/apply-fixes",
    {
      document_id: documentId,
      segment_ids: segmentIds,
    },
  );
  return res.data;
}

export async function editValidationSegment(
  documentId: string,
  segmentId: string,
  newText: string,
): Promise<EditSegmentResponse> {
  const res = await apiClient.post<EditSegmentResponse>(
    "/validate/edit-segment",
    {
      document_id: documentId,
      segment_id: segmentId,
      new_text: newText,
    },
  );
  return res.data;
}

export async function translateDocument(
  documentId: string,
  targetLanguage: string,
  styleRules?: string[],
  segmentIds?: string[],
): Promise<TranslateResponse> {
  const res = await apiClient.post<TranslateResponse>(
    "/translate",
    {
      document_id: documentId,
      target_language: targetLanguage,
      style_rules: styleRules,
      segment_ids: segmentIds,
    },
    {
      timeout: 0,
    },
  );
  return res.data;
}

export async function streamTranslateDocument(
  documentId: string,
  targetLanguage: string,
  styleRules: string[] | undefined,
  segmentIds: string[] | undefined,
  onEvent: StreamEventHandler<TranslationStreamEvent>,
  signal?: AbortSignal,
): Promise<void> {
  await streamNdjson<TranslationStreamEvent>(
    "/translate/stream",
    {
      document_id: documentId,
      target_language: targetLanguage,
      style_rules: styleRules ?? [],
      segment_ids: segmentIds,
    },
    onEvent,
    signal,
  );
}

export async function getSegments(
  docId: string,
  status?: string,
  type?: string,
): Promise<Segment[]> {
  const res = await apiClient.get<Segment[]>(`/segments/${docId}`, {
    params: { status, type },
  });
  return res.data;
}

export async function getCollaborationState(
  documentId: string,
): Promise<CollaborationStateResponse> {
  const res = await apiClient.get<CollaborationStateResponse>(
    `/collaboration/document/${documentId}`,
    { timeout: 0 },
  );
  return res.data;
}

export async function assignSegments(
  documentId: string,
  segmentIds: string[],
  assigneeClerkUserId: string,
): Promise<{ document_id: string; assignments: CollaborationAssignment[] }> {
  const res = await apiClient.post<{ document_id: string; assignments: CollaborationAssignment[] }>(
    "/collaboration/assign",
    {
      document_id: documentId,
      segment_ids: segmentIds,
      assignee_clerk_user_id: assigneeClerkUserId,
    },
    { timeout: 0 },
  );
  return res.data;
}

export async function claimSegments(
  documentId: string,
  segmentIds: string[],
  assigneeClerkUserId: string,
): Promise<{ document_id: string; assignments: CollaborationAssignment[] }> {
  const res = await apiClient.post<{ document_id: string; assignments: CollaborationAssignment[] }>(
    "/collaboration/claim",
    {
      document_id: documentId,
      segment_ids: segmentIds,
      assignee_clerk_user_id: assigneeClerkUserId,
    },
    { timeout: 0 },
  );
  return res.data;
}

export async function lockSegment(
  documentId: string,
  segmentId: string,
): Promise<{ document_id: string; lock: CollaborationLock }> {
  const res = await apiClient.post<{ document_id: string; lock: CollaborationLock }>(
    "/collaboration/lock",
    {
      document_id: documentId,
      segment_id: segmentId,
    },
    { timeout: 0 },
  );
  return res.data;
}

export async function unlockSegment(
  documentId: string,
  segmentId: string,
): Promise<{ document_id: string; segment_id: string; unlocked: boolean }> {
  const res = await apiClient.post<{ document_id: string; segment_id: string; unlocked: boolean }>(
    "/collaboration/unlock",
    {
      document_id: documentId,
      segment_id: segmentId,
    },
    { timeout: 0 },
  );
  return res.data;
}

export async function approveSegment(
  segmentId: string,
  approved: boolean,
  correction?: string,
): Promise<ApproveResponse> {
  const res = await apiClient.post<ApproveResponse>("/approve", {
    segment_id: segmentId,
    approved,
    correction,
  });
  return res.data;
}

export async function getGlossary(): Promise<GlossaryResponse> {
  const res = await apiClient.get<GlossaryResponse>("/glossary");
  return res.data;
}

export async function addGlossaryTerm(
  term: GlossaryTerm,
): Promise<GlossaryResponse> {
  const res = await apiClient.post<GlossaryResponse>("/glossary", { term });
  return res.data;
}

export async function checkHealth(): Promise<{ status: string }> {
  const res = await apiClient.get<{ status: string }>("/health");
  return res.data;
}

export async function getTranslateInfo(): Promise<TranslateInfoResponse> {
  const res = await apiClient.get<TranslateInfoResponse>("/translate/info");
  return res.data;
}

export async function getExportStatus(
  documentId: string,
): Promise<ExportStatusResponse> {
  const res = await apiClient.get<ExportStatusResponse>(
    `/export/status/${documentId}`,
  );
  return res.data;
}

export async function downloadExport(
  documentId: string,
  format: ExportFormat,
): Promise<string> {
  const response = await apiClient.post<Blob>(
    `/export/${documentId}?format=${format}`,
    undefined,
    {
      responseType: "blob",
      timeout: 120000,
    },
  );

  const blob = response.data;
  const url = URL.createObjectURL(blob);
  const disposition =
    typeof response.headers["content-disposition"] === "string"
      ? response.headers["content-disposition"]
      : "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/);
  const filename =
    match?.[1] ?? `translation.${format === "same" ? "docx" : format}`;

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);

  return filename;
}

export async function createShareLink(
  documentId: string,
): Promise<{ shareId: string; shareUrl: string }> {
  const response = await fetch("/api/shares", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ documentId }),
  });

  if (!response.ok) {
    throw new Error("Failed to create share link.");
  }

  return response.json();
}

export async function registerDocumentOwner(documentId: string): Promise<void> {
  const response = await fetch("/api/documents/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ documentId }),
  });

  if (!response.ok) {
    throw new Error("Failed to register document owner.");
  }
}

export async function getDocumentCollaborators(
  documentId: string,
): Promise<DocumentCollaboratorsResponse> {
  const response = await fetch(`/api/documents/${documentId}/collaborators`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to load collaborators.");
  }

  return response.json();
}

export async function addDocumentCollaborator(
  documentId: string,
  email: string,
  role: Exclude<CollaboratorRole, "owner">,
): Promise<DocumentCollaboratorsResponse> {
  const response = await fetch(`/api/documents/${documentId}/collaborators`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, role }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Failed to add collaborator.");
  }

  return response.json();
}

export async function removeDocumentCollaborator(
  documentId: string,
  collaboratorClerkUserId: string,
): Promise<DocumentCollaboratorsResponse> {
  const response = await fetch(`/api/documents/${documentId}/collaborators`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ collaboratorClerkUserId }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Failed to remove collaborator.");
  }

  return response.json();
}

export async function getDocumentPresence(
  documentId: string,
): Promise<DocumentPresenceResponse> {
  const response = await fetch(`/api/documents/${documentId}/presence`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Failed to load presence.");
  }

  return response.json();
}

export async function heartbeatDocumentPresence(
  documentId: string,
): Promise<DocumentPresenceResponse> {
  const response = await fetch(`/api/documents/${documentId}/presence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Failed to update presence.");
  }

  return response.json();
}

export async function clearDocumentPresence(
  documentId: string,
): Promise<void> {
  const response = await fetch(`/api/documents/${documentId}/presence`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    keepalive: true,
  });

  if (!response.ok) {
    throw new Error("Failed to clear presence.");
  }
}

export async function getShareOverview(): Promise<ShareOverviewResponse> {
  const response = await fetch("/api/shares", {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to load share overview.");
  }

  return response.json();
}
