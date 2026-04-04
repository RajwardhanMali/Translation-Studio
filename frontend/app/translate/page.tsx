"use client";

import { useEffect, useState, Suspense } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Languages,
  Lightbulb,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HoverCard, Reveal } from "@/components/motion/primitives";
import {
  HoverCard as ProfileHoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  approveSegment,
  createShareLink,
  downloadExport,
  getExportStatus,
  getSegments,
  getShareOverview,
  translateDocument,
  type ExportFormat,
  type ExportStatusResponse,
  type Segment,
  type ShareOverviewResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const LANGUAGES = [
  { value: "fr", label: "French (fr)" },
  { value: "es", label: "Spanish (es)" },
  { value: "de", label: "German (de)" },
  { value: "it", label: "Italian (it)" },
  { value: "pt", label: "Portuguese (pt)" },
  { value: "zh", label: "Chinese (zh)" },
  { value: "ja", label: "Japanese (ja)" },
  { value: "ar", label: "Arabic (ar)" },
  { value: "hi", label: "Hindi (hi)" },
];

const STATUS_FILTERS = ["all", "pending", "reviewed", "approved"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const VISIBLE_TYPES = new Set(["sentence", "heading", "table_cell"]);
type WorkspaceSegment = Segment & {
  sourceEdited?: boolean;
};

type LocalWorkspaceState = {
  sourceOverrides: Record<string, string>;
  outputOverrides: Record<string, string>;
};

function getWorkspaceStorageKey(documentId: string) {
  return `translation-studio-workspace:${documentId}`;
}

function readLocalWorkspaceState(documentId: string): LocalWorkspaceState {
  if (typeof window === "undefined" || !documentId) {
    return { sourceOverrides: {}, outputOverrides: {} };
  }

  try {
    const raw = window.localStorage.getItem(getWorkspaceStorageKey(documentId));
    if (!raw) {
      return { sourceOverrides: {}, outputOverrides: {} };
    }

    const parsed = JSON.parse(raw) as Partial<LocalWorkspaceState>;

    return {
      sourceOverrides:
        parsed.sourceOverrides && typeof parsed.sourceOverrides === "object"
          ? parsed.sourceOverrides
          : {},
      outputOverrides:
        parsed.outputOverrides && typeof parsed.outputOverrides === "object"
          ? parsed.outputOverrides
          : {},
    };
  } catch {
    return { sourceOverrides: {}, outputOverrides: {} };
  }
}

function persistLocalWorkspaceState(
  documentId: string,
  state: LocalWorkspaceState,
) {
  if (typeof window === "undefined" || !documentId) return;

  window.localStorage.setItem(
    getWorkspaceStorageKey(documentId),
    JSON.stringify(state),
  );
}

function normalizeSegment(
  raw: Partial<Segment> & Record<string, unknown>,
  index: number,
): Segment {
  const segmentId = String(raw.segment_id ?? raw.id ?? `segment-${index}`);
  const sourceText =
    typeof raw.source_text === "string"
      ? raw.source_text
      : typeof raw.source === "string"
        ? raw.source
        : typeof raw.text === "string"
          ? raw.text
          : "";
  const translatedText =
    typeof raw.translated_text === "string"
      ? raw.translated_text
      : typeof raw.translation === "string"
        ? raw.translation
        : "";
  const finalText =
    typeof raw.final_text === "string"
      ? raw.final_text
      : typeof raw.correction === "string"
        ? raw.correction
        : undefined;

  return {
    segment_id: segmentId,
    source_text: sourceText,
    translated_text: translatedText,
    final_text: finalText,
    status: (raw.status as Segment["status"]) ?? "pending",
    type: typeof raw.type === "string" ? raw.type : "sentence",
    tm_match_type: (raw.tm_match_type as Segment["tm_match_type"]) ?? null,
    tm_suggestions: Array.isArray(raw.tm_suggestions)
      ? (raw.tm_suggestions as Segment["tm_suggestions"])
      : [],
    glossary_violations: Array.isArray(raw.glossary_violations)
      ? (raw.glossary_violations as string[])
      : [],
    format_snapshot:
      raw.format_snapshot && typeof raw.format_snapshot === "object"
        ? (raw.format_snapshot as Segment["format_snapshot"])
        : null,
    row: typeof raw.row === "number" ? raw.row : null,
    col: typeof raw.col === "number" ? raw.col : null,
  };
}

function getStatusParam(statusFilter: StatusFilter) {
  return statusFilter === "all" ? undefined : statusFilter;
}

function getUserInitials(name?: string | null, email?: string | null) {
  const source = (name || email || "User").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function isTranslationError(text: string | undefined) {
  return Boolean(
    text &&
    (text.startsWith("[ERROR") || text.startsWith("[TRANSLATION ERROR")),
  );
}

function isVisibleSegment(segment: Segment) {
  return segment.status !== "skip" && VISIBLE_TYPES.has(segment.type);
}

function StatusPill({
  status,
}: {
  status: Segment["status"] | string | undefined;
}) {
  const map = {
    pending: {
      label: "Pending",
      className:
        "border-slate-300/70 bg-slate-100/90 text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200",
    },
    reviewed: {
      label: "Reviewed",
      className:
        "border-amber-300/70 bg-amber-100/90 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200",
    },
    approved: {
      label: "Approved",
      className:
        "border-emerald-300/70 bg-emerald-100/90 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200",
    },
  } as const;

  const current = map[status as keyof typeof map] ?? {
    label: String(status ?? "Unknown"),
    className: "border-border bg-muted text-muted-foreground",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
        current.className,
      )}
    >
      {current.label}
    </span>
  );
}

function TmMatchBadge({
  tmMatchType,
}: {
  tmMatchType: Segment["tm_match_type"];
}) {
  if (!tmMatchType) return null;

  const map = {
    exact:
      "border-emerald-300/70 bg-emerald-100/90 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200",
    fuzzy:
      "border-amber-300/70 bg-amber-100/90 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200",
    new: "border-sky-300/70 bg-sky-100/90 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-200",
  } as const;

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 text-[10px] font-semibold",
        map[tmMatchType],
      )}
    >
      {tmMatchType === "exact"
        ? "TM exact"
        : tmMatchType === "fuzzy"
          ? "TM fuzzy"
          : "New"}
    </Badge>
  );
}

interface SegmentRowProps {
  segment: WorkspaceSegment;
  selected: boolean;
  onSelect: (id: string) => void;
  onApprove: (segment: WorkspaceSegment, finalText: string) => Promise<void>;
  onUpdateOutput: (segmentId: string, finalText: string) => void;
  onUpdateSource: (segmentId: string, sourceText: string) => void;
  onRetry: (segment: WorkspaceSegment) => Promise<void>;
  retrying: boolean;
}

function SegmentRow({
  segment,
  selected,
  onSelect,
  onApprove,
  onUpdateOutput,
  onUpdateSource,
  onRetry,
  retrying,
}: SegmentRowProps) {
  const [editingMode, setEditingMode] = useState<"none" | "source" | "output">(
    "none",
  );
  const [sourceValue, setSourceValue] = useState(segment.source_text);
  const [outputValue, setOutputValue] = useState(
    segment.final_text || segment.translated_text,
  );
  const [approving, setApproving] = useState(false);
  const [showTM, setShowTM] = useState(false);

  useEffect(() => {
    setSourceValue(segment.source_text);
    setOutputValue(segment.final_text || segment.translated_text);
  }, [segment.source_text, segment.final_text, segment.translated_text]);

  const statusAccentMap: Record<string, string> = {
    pending: "before:bg-slate-400",
    reviewed: "before:bg-amber-400",
    approved: "before:bg-emerald-400",
  };

  const handleApprove = async () => {
    setApproving(true);
    await onApprove(segment, outputValue);
    setEditingMode("none");
    setApproving(false);
  };

  const handleEditSource = () => {
    setSourceValue(segment.source_text);
    setEditingMode("source");
  };

  const handleEditOutput = () => {
    setOutputValue(segment.final_text || segment.translated_text);
    setEditingMode("output");
  };

  const handleCancel = () => {
    setSourceValue(segment.source_text);
    setOutputValue(segment.final_text || segment.translated_text);
    setEditingMode("none");
  };

  const handleSave = () => {
    if (editingMode === "source") {
      onUpdateSource(segment.segment_id, sourceValue);
    }

    if (editingMode === "output") {
      onUpdateOutput(segment.segment_id, outputValue);
    }

    setEditingMode("none");
  };

  const isHeading = segment.type === "heading";
  const isTableCell = segment.type === "table_cell";
  const sourceTextClass = isHeading
    ? "text-lg font-semibold leading-8"
    : "text-sm leading-7";
  const outputTextClass = isHeading
    ? "text-base font-semibold leading-8"
    : "text-sm leading-7";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className={cn(
        "relative overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/90 shadow-[0_18px_50px_-34px_rgba(15,23,42,0.45)] transition-all duration-200 before:absolute before:inset-y-0 before:left-0 before:w-1.5",
        statusAccentMap[segment.status] ?? "before:bg-border",
        selected &&
          "ring-2 ring-primary/70 ring-offset-2 ring-offset-background",
        isTranslationError(segment.translated_text) &&
          "border-red-300/70 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(segment.segment_id)}
            className="h-4 w-4 rounded accent-primary"
          />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Segment {segment.segment_id}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusPill status={segment.status} />
              <TmMatchBadge tmMatchType={segment.tm_match_type} />
              {isHeading && (
                <Badge
                  variant="outline"
                  className="rounded-full text-[10px] font-semibold"
                >
                  H{segment.format_snapshot?.level ?? 1}
                </Badge>
              )}
              {isTableCell && segment.row !== null && segment.col !== null && (
                <Badge
                  variant="outline"
                  className="rounded-full text-[10px] font-semibold"
                >
                  Table r{segment.row} c{segment.col}
                </Badge>
              )}
              {segment.glossary_violations &&
                segment.glossary_violations.length > 0 && (
                  <Badge
                    variant="outline"
                    className="rounded-full border-amber-300/70 bg-amber-100/90 text-[10px] font-semibold text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200"
                  >
                    {segment.glossary_violations.length} glossary alert
                  </Badge>
                )}
            </div>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center md:w-auto md:justify-end">
          {editingMode !== "none" ? (
            <>
              <Button
                size="icon-sm"
                onClick={handleSave}
                className="rounded-xl justify-center"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                onClick={handleCancel}
                className="rounded-xl justify-center"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void onRetry(segment)}
                disabled={retrying}
                className="rounded-xl"
              >
                {retrying ? (
                  <Spinner className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Retranslate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleEditSource}
                className="rounded-xl"
              >
                Edit Source
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleEditOutput}
                className="rounded-xl"
              >
                Edit Output
              </Button>
              <Button
                size="icon-sm"
                onClick={handleApprove}
                disabled={approving || segment.status === "approved"}
                className="rounded-xl justify-center"
              >
                {approving ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[1fr_1fr]">
        <div className="motion-card-subtle rounded-2xl border border-border/60 bg-background/65 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Source
            </p>
            {segment.sourceEdited && (
              <Badge variant="outline" className="rounded-full text-[10px]">
                Local source edit
              </Badge>
            )}
          </div>
          {editingMode === "source" ? (
            <Textarea
              value={sourceValue}
              onChange={(e) => setSourceValue(e.target.value)}
              className="min-h-[144px] resize-none rounded-2xl border-border/70 bg-background/90 text-sm leading-7"
              autoFocus
            />
          ) : (
            <p className={cn("break-words text-foreground", sourceTextClass)}>
              {segment.source_text}
            </p>
          )}
          {segment.glossary_violations &&
            segment.glossary_violations.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {segment.glossary_violations.map((violation, index) => (
                  <span
                    key={`${segment.segment_id}-glossary-${index}-${violation}`}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300/70 bg-amber-100/90 px-2.5 py-1 text-[11px] text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200"
                  >
                    <BookOpen className="h-3 w-3" />
                    {violation}
                  </span>
                ))}
              </div>
            )}
        </div>

        <div className="motion-card-subtle rounded-2xl border border-border/60 bg-background/65 p-4">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Translated Output
            </p>
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          {editingMode === "output" ? (
            <Textarea
              value={outputValue}
              onChange={(e) => setOutputValue(e.target.value)}
              className="min-h-[144px] resize-none rounded-2xl border-border/70 bg-background/90 text-sm leading-7"
              autoFocus
            />
          ) : (
            <p
              className={cn(
                "break-words",
                outputTextClass,
                isTranslationError(segment.translated_text)
                  ? "text-red-700 dark:text-red-300"
                  : "text-foreground",
                !segment.final_text &&
                  !segment.translated_text &&
                  "italic text-muted-foreground",
              )}
            >
              {segment.final_text ||
                segment.translated_text ||
                "Not yet translated"}
            </p>
          )}
          {(segment.tm_suggestions?.length ?? 0) > 0 && (
            <button
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
              onClick={() => setShowTM((value) => !value)}
            >
              <Lightbulb className="h-3.5 w-3.5" />
              {segment.tm_suggestions!.length} suggestion
              {segment.tm_suggestions!.length !== 1 ? "s" : ""}
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  showTM && "rotate-90",
                )}
              />
            </button>
          )}
        </div>
      </div>

      {showTM &&
        segment.tm_suggestions &&
        segment.tm_suggestions.length > 0 && (
          <div className="border-t border-border/60 bg-muted/35 px-4 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Translation Memory Suggestions
            </p>
            <div className="grid gap-3">
              {segment.tm_suggestions.map((tm, index) => (
                <div
                  key={`${segment.segment_id}-tm-${index}-${tm.text}`}
                  className="motion-card-subtle flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/90 p-4 lg:flex-row lg:items-start lg:justify-between"
                >
                  <p className="flex-1 text-sm leading-7 text-foreground">
                    {tm.text}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full px-2.5 font-mono text-[11px]",
                        tm.score >= 90
                          ? "border-emerald-300/70 text-emerald-700 dark:border-emerald-800/70 dark:text-emerald-200"
                          : tm.score >= 70
                            ? "border-amber-300/70 text-amber-700 dark:border-amber-800/70 dark:text-amber-200"
                            : "border-slate-300/70 text-slate-700 dark:border-slate-700 dark:text-slate-200",
                      )}
                    >
                      {tm.score}%
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-xl"
                      onClick={() => {
                        onUpdateOutput(segment.segment_id, tm.text);
                        setShowTM(false);
                      }}
                    >
                      Use Suggestion
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
    </motion.div>
  );
}

function TranslatePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const docId = searchParams.get("doc") ?? "";

  const [segments, setSegments] = useState<WorkspaceSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState("fr");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [translationMessage, setTranslationMessage] = useState<string | null>(
    null,
  );
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatusResponse | null>(
    null,
  );
  const [shareOverview, setShareOverview] = useState<ShareOverviewResponse>({
    ownedByDocument: {},
    receivedDocumentIds: [],
  });
  const [exportFormat, setExportFormat] = useState<ExportFormat>("same");
  const [exporting, setExporting] = useState(false);
  const [sourceOverrides, setSourceOverrides] = useState<
    Record<string, string>
  >({});
  const [outputOverrides, setOutputOverrides] = useState<
    Record<string, string>
  >({});

  const selectableIds = segments.map((segment) => segment.segment_id);
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((segmentId) => selectedIds.has(segmentId));

  useEffect(() => {
    if (!docId) return;

    const storedState = readLocalWorkspaceState(docId);
    setSourceOverrides(storedState.sourceOverrides);
    setOutputOverrides(storedState.outputOverrides);
  }, [docId]);

  useEffect(() => {
    if (!docId) return;

    persistLocalWorkspaceState(docId, {
      sourceOverrides,
      outputOverrides,
    });
  }, [docId, outputOverrides, sourceOverrides]);

  const loadSegments = async (
    nextStatusFilter: StatusFilter = statusFilter,
  ) => {
    setLoading(true);

    if (!docId) {
      setSegments([]);
      setLoading(false);
      return;
    }

    try {
      const data = await getSegments(docId, getStatusParam(nextStatusFilter));
      const normalizedSegments = data
        .map((segment, index) =>
          normalizeSegment(
            segment as Partial<Segment> & Record<string, unknown>,
            index,
          ),
        )
        .filter(isVisibleSegment)
        .map((segment) => ({
          ...segment,
          source_text:
            sourceOverrides[segment.segment_id] ?? segment.source_text,
          final_text: outputOverrides[segment.segment_id] ?? segment.final_text,
          sourceEdited: Boolean(sourceOverrides[segment.segment_id]),
        }));

      setSegments(normalizedSegments);
    } catch {
      toast({
        title: "Failed to load segments",
        description:
          "Could not fetch translation segments from the backend. Ensure the API is running and the URL is configured correctly.",
        variant: "destructive",
      });
      setSegments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSegments(statusFilter);
  }, [docId, outputOverrides, sourceOverrides, statusFilter]);

  useEffect(() => {
    if (!docId) {
      setExportStatus(null);
      return;
    }

    getExportStatus(docId)
      .then((data) => setExportStatus(data))
      .catch(() => setExportStatus(null));
  }, [docId, segments]);

  useEffect(() => {
    if (!docId) {
      setShareOverview({ ownedByDocument: {}, receivedDocumentIds: [] });
      return;
    }

    getShareOverview()
      .then((data) => setShareOverview(data))
      .catch(() =>
        setShareOverview({ ownedByDocument: {}, receivedDocumentIds: [] }),
      );
  }, [docId]);

  const refreshSingleSegment = async (segmentId: string) => {
    const refreshed = (await getSegments(docId, getStatusParam(statusFilter)))
      .map((segment, index) =>
        normalizeSegment(
          segment as Partial<Segment> & Record<string, unknown>,
          index,
        ),
      )
      .filter(isVisibleSegment);
    const nextSegment = refreshed.find(
      (segment) => segment.segment_id === segmentId,
    );

    if (!nextSegment) {
      setSegments((prev) =>
        prev.filter((segment) => segment.segment_id !== segmentId),
      );
      return;
    }

    setSegments((prev) =>
      prev.map((segment) =>
        segment.segment_id === segmentId
          ? {
              ...nextSegment,
              source_text:
                sourceOverrides[nextSegment.segment_id] ??
                nextSegment.source_text,
              final_text:
                outputOverrides[nextSegment.segment_id] ??
                nextSegment.final_text,
              sourceEdited: Boolean(sourceOverrides[nextSegment.segment_id]),
            }
          : segment,
      ),
    );
  };

  const handleTranslate = async () => {
    if (!docId) return;
    const segmentIds = Array.from(selectedIds);

    if (segmentIds.length === 0) {
      setTranslationMessage("Select one or more segments to translate.");
      toast({
        title: "No segments selected",
        description: "Choose the segments you want to translate first.",
        variant: "destructive",
      });
      return;
    }

    setTranslating(true);
    setTranslationMessage(null);

    try {
      const data = await translateDocument(docId, targetLang, [], segmentIds);
      await loadSegments(statusFilter);
      const exportData = await getExportStatus(docId).catch(() => null);
      setExportStatus(exportData);
      setTranslationMessage(
        `${data.segments_translated} selected segment${data.segments_translated === 1 ? "" : "s"} translated`,
      );
    } catch (error) {
      setTranslationMessage("Translation failed. Please try again.");
      toast({
        title: "Translation failed",
        description:
          "Could not run translation. Ensure the backend is running and the API URL is configured correctly.",
        variant: "destructive",
      });
    } finally {
      setTranslating(false);
    }
  };

  const handleRetry = async (segment: WorkspaceSegment) => {
    if (sourceOverrides[segment.segment_id]) {
      setTranslationMessage(
        "Retranslation uses the backend's original source for edited segments.",
      );
    }

    setRetryingId(segment.segment_id);
    try {
      await translateDocument(docId, targetLang, [], [segment.segment_id]);
      await refreshSingleSegment(segment.segment_id);
      const exportData = await getExportStatus(docId).catch(() => null);
      setExportStatus(exportData);
      setTranslationMessage("Selected segment retranslated.");
    } catch {
      setTranslationMessage("Segment retranslation failed. Please try again.");
      toast({
        title: "Retry failed",
        description: "The segment could not be retranslated right now.",
        variant: "destructive",
      });
    } finally {
      setRetryingId(null);
    }
  };

  const handleExport = async () => {
    if (!docId) return;

    setExporting(true);
    try {
      const filename = await downloadExport(docId, exportFormat);
      toast({ title: "Export started", description: filename });
    } catch {
      toast({
        title: "Export failed",
        description: "The translated file could not be downloaded right now.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleApprove = async (
    segment: WorkspaceSegment,
    finalText: string,
    options?: { silentSuccess?: boolean },
  ) => {
    const segmentId = segment.segment_id;

    try {
      const response = await approveSegment(segmentId, true, finalText);
      setOutputOverrides((prev) => {
        const next = { ...prev };
        delete next[segmentId];
        return next;
      });
      if (statusFilter === "all") {
        setSegments((prev) =>
          prev.map((segment) =>
            segment.segment_id === segmentId
              ? {
                  ...segment,
                  status: response.status as Segment["status"],
                  final_text: finalText,
                }
              : segment,
          ),
        );
      } else {
        await loadSegments(statusFilter);
      }
      const exportData = await getExportStatus(docId).catch(() => null);
      setExportStatus(exportData);
      if (!options?.silentSuccess) {
        toast({
          title: "Segment approved",
          description: "Correction saved and learning triggered.",
        });
      }
    } catch {
      toast({
        title: "Failed to approve segment",
        description: "Could not save approval changes to the backend.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateOutput = (segmentId: string, finalText: string) => {
    setOutputOverrides((prev) => ({ ...prev, [segmentId]: finalText }));
    setSegments((prev) =>
      prev.map((segment) =>
        segment.segment_id === segmentId
          ? { ...segment, final_text: finalText }
          : segment,
      ),
    );
  };

  const handleUpdateSource = (segmentId: string, sourceText: string) => {
    setSourceOverrides((prev) => ({ ...prev, [segmentId]: sourceText }));
    setSegments((prev) =>
      prev.map((segment) =>
        segment.segment_id === segmentId
          ? { ...segment, source_text: sourceText, sourceEdited: true }
          : segment,
      ),
    );
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkApprove = async () => {
    const count = selectedIds.size;

    for (const id of selectedIds) {
      const segment = segments.find((item) => item.segment_id === id);
      if (segment)
        await handleApprove(
          segment,
          segment.final_text || segment.translated_text,
          { silentSuccess: true },
        );
    }
    setSelectedIds(new Set());
    if (count > 0) {
      toast({ title: `${count} segments approved` });
    }
  };

  const handleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allSelected) {
        return new Set();
      }

      return new Set(selectableIds);
    });
  };

  const handleShare = async () => {
    if (!docId) return;

    try {
      const share = await createShareLink(docId);
      const absoluteUrl = `${window.location.origin}${share.shareUrl}`;
      await navigator.clipboard.writeText(absoluteUrl);
      toast({
        title: "Share link copied",
        description: "Send the link to a teammate to open the same document.",
      });
    } catch {
      toast({
        title: "Share failed",
        description: "We could not create a share link for this document.",
        variant: "destructive",
      });
    }
  };

  const completedCount = segments.filter(
    (segment) => segment.status === "reviewed" || segment.status === "approved",
  ).length;
  const approvedCount = segments.filter(
    (segment) => segment.status === "approved",
  ).length;
  const pendingCount = segments.filter(
    (segment) => segment.status === "pending",
  ).length;
  const flaggedCount = segments.filter(
    (segment) =>
      isTranslationError(segment.translated_text) ||
      (segment.glossary_violations && segment.glossary_violations.length > 0),
  ).length;
  const progress = segments.length
    ? Math.round((completedCount / segments.length) * 100)
    : 0;
  const sharedRecipients =
    docId && shareOverview.ownedByDocument[docId]
      ? shareOverview.ownedByDocument[docId].recipients
      : [];
  const recipientOffsets = [
    "left-[10%] top-[14%]",
    "left-[36%] top-[38%]",
    "right-[18%] top-[12%]",
    "right-[6%] top-[52%]",
    "left-[18%] bottom-[8%]",
    "left-[56%] bottom-[14%]",
  ];
  const recipientThemes = [
    "from-cyan-400/70 via-sky-400/65 to-blue-500/75",
    "from-teal-400/70 via-cyan-400/60 to-sky-500/70",
    "from-blue-400/70 via-indigo-400/60 to-cyan-500/70",
    "from-emerald-400/70 via-teal-400/60 to-cyan-500/70",
    "from-sky-400/70 via-blue-400/60 to-indigo-500/70",
    "from-cyan-400/70 via-teal-400/60 to-emerald-500/70",
  ];

  return (
    <AppShell
      title="Translation Editor"
      subtitle={
        docId
          ? `Document ${docId.slice(0, 20)}...  |  ${segments.length} segments in review`
          : "Open a document to start translating"
      }
    >
      <div className="space-y-6">
        <Reveal className="glass-panel hero-sheen overflow-hidden rounded-[2rem]">
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:px-8 lg:py-8">
            <div className="min-w-0">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{
                  duration: 0.4,
                  delay: 0.08,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground"
              >
                <WandSparkles className="h-3.5 w-3.5 text-primary" />
                Structured translation workspace
              </motion.div>
              <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                Review translations faster with a cleaner, calmer editor.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
                Generate drafts, inspect glossary risks, compare translation
                memory suggestions, and approve final copy without losing focus.
              </p>
            </div>

            <div className="hidden lg:block">
              <div className="relative min-h-[16rem] overflow-hidden rounded-[1.75rem] border border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(245,249,255,0.45))] shadow-[0_28px_80px_-55px_rgba(14,116,144,0.35)] dark:bg-[linear-gradient(180deg,rgba(7,15,28,0.8),rgba(8,16,30,0.56))] dark:shadow-[0_28px_80px_-55px_rgba(8,145,178,0.42)]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.1),transparent_28%),radial-gradient(circle_at_80%_18%,rgba(59,130,246,0.12),transparent_24%),radial-gradient(circle_at_48%_82%,rgba(45,212,191,0.12),transparent_22%)] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_80%_18%,rgba(59,130,246,0.14),transparent_24%),radial-gradient(circle_at_48%_82%,rgba(45,212,191,0.12),transparent_22%)]" />
                <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700/80 dark:text-cyan-100/75">
                      Shared with
                    </p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {sharedRecipients.length > 0
                        ? `${sharedRecipients.length} collaborator${sharedRecipients.length === 1 ? "" : "s"} in this document`
                        : "Share this file to bring reviewers here"}
                    </p>
                  </div>
                  <div className="rounded-full border border-cyan-300/25 bg-white/60 px-3 py-1 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                    Live access
                  </div>
                </div>

                {sharedRecipients.length > 0 ? (
                  <div className="relative h-full min-h-[16rem] mt-10">
                    {sharedRecipients.slice(0, 6).map((recipient, index) => (
                      <motion.div
                        key={`${recipient.clerkUserId}-${index}`}
                        className={`absolute ${recipientOffsets[index % recipientOffsets.length]}`}
                        animate={{
                          y: [0, -10, 0],
                          rotate: [0, index % 2 === 0 ? 2 : -2, 0],
                        }}
                        transition={{
                          duration: 5.8 + index * 0.35,
                          repeat: Infinity,
                          repeatType: "mirror",
                          ease: "easeInOut",
                          delay: index * 0.18,
                        }}
                      >
                        <ProfileHoverCard openDelay={120} closeDelay={120}>
                          <HoverCardTrigger asChild>
                            <button className="group relative">
                              <div
                                className={`absolute inset-0 rounded-full bg-gradient-to-br ${recipientThemes[index % recipientThemes.length]} opacity-50 blur-xl transition-opacity group-hover:opacity-90`}
                              />
                              <Avatar className="relative h-16 w-16 border border-white/60 shadow-[0_18px_45px_-25px_rgba(8,145,178,0.45)] dark:border-white/20 dark:shadow-[0_18px_45px_-25px_rgba(8,145,178,0.8)]">
                                <AvatarFallback
                                  className={`bg-gradient-to-br ${recipientThemes[index % recipientThemes.length]} text-base font-semibold text-white`}
                                >
                                  {getUserInitials(
                                    recipient.name,
                                    recipient.email,
                                  )}
                                </AvatarFallback>
                              </Avatar>
                            </button>
                          </HoverCardTrigger>
                          <HoverCardContent
                            side="top"
                            align="center"
                            className="w-56 rounded-2xl border-border/70 bg-background/95 p-4 backdrop-blur"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar className="h-11 w-11 border border-border/60">
                                <AvatarFallback
                                  className={`bg-gradient-to-br ${recipientThemes[index % recipientThemes.length]} text-sm font-semibold text-white`}
                                >
                                  {getUserInitials(
                                    recipient.name,
                                    recipient.email,
                                  )}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">
                                  {recipient.name || "Collaborator"}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {recipient.email}
                                </p>
                              </div>
                            </div>
                          </HoverCardContent>
                        </ProfileHoverCard>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[16rem] items-center justify-center px-8">
                    <p className="max-w-xs text-center text-sm leading-7 text-slate-500 dark:text-slate-400">
                      When collaborators open your share link, they'll appear
                      here as floating presence avatars.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Reveal>

        <section className="grid items-start gap-4">
          <Reveal
            delay={0.05}
            className="glass-panel self-start rounded-[1.75rem] border border-border/70 p-5"
          >
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Review Controls
                </p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Filter the queue, track progress, and take action on segments
                  without leaving the page.
                </p>
              </div>

              <div className="w-full rounded-2xl border border-border/60 bg-background/75 p-4 md:max-w-sm">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>Completion</span>
                  <span className="font-mono">
                    {completedCount}/{segments.length}
                  </span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary via-sky-400 to-cyan-400 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Button
                  variant="outline"
                  className="h-10 rounded-full"
                  onClick={() => void loadSegments(statusFilter)}
                  disabled={loading}
                >
                  <RefreshCw
                    className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
                  />
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  className="h-10 rounded-full"
                  onClick={handleSelectAll}
                >
                  {allSelected ? "Clear Selection" : "Select All"}
                </Button>
                {selectedIds.size > 0 && (
                  <Button
                    variant="outline"
                    className="h-10 rounded-full"
                    onClick={() => void handleBulkApprove()}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Bulk Accept ({selectedIds.size})
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-10 rounded-full"
                  onClick={() => void handleShare()}
                  disabled={!docId}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Share
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                {STATUS_FILTERS.map((filter) => {
                  const count =
                    filter === "all"
                      ? segments.length
                      : segments.filter((segment) => segment.status === filter)
                          .length;
                  return (
                    <button
                      key={filter}
                      onClick={() => setStatusFilter(filter)}
                      className={cn(
                        "min-w-0 rounded-full border px-4 py-2 text-sm font-medium capitalize transition-all duration-200",
                        statusFilter === filter
                          ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-sky-500/15"
                          : "border-border/70 bg-background/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      {filter}
                      {count > 0 && (
                        <span className="ml-1 opacity-75">({count})</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Review",
                  value: `${progress}%`,
                  note: `${completedCount}/${segments.length} completed`,
                  borderColor: "border-primary",
                },
                {
                  label: "Approved",
                  value: `${approvedCount}`,
                  note: "Finalized",
                  borderColor: "border-emerald-300",
                },
                {
                  label: "Pending",
                  value: `${pendingCount}`,
                  note: "Needs review",
                  borderColor: "border-amber-300",
                },
                {
                  label: "Attention",
                  value: `${flaggedCount}`,
                  note: "Errors or alerts",
                  borderColor: "border-red-300",
                },
              ].map((item, index) => (
                <HoverCard
                  key={item.label}
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{
                    duration: 0.4,
                    delay: index * 0.05,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className={`rounded-[1.25rem] border border-border/60 bg-background/78 p-3.5 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.55)] ${item.borderColor}`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                    {item.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.note}
                  </p>
                </HoverCard>
              ))}
            </div>

            {translationMessage && !translating && (
              <div
                className={cn(
                  "mt-5 rounded-2xl border px-4 py-3 text-sm",
                  translationMessage.includes("translated")
                    ? "border-emerald-300/70 bg-emerald-100/80 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : "border-border/70 bg-background/75 text-muted-foreground",
                )}
              >
                {translationMessage}
              </div>
            )}

            {translating && (
              <div className="mt-5 rounded-[1.5rem] border border-primary/20 bg-primary/8 p-5">
                <div className="flex items-start gap-3">
                  <Spinner className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Translating... this may take a moment for large documents.
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Keep this page open while the segments are translated and
                      refreshed.
                    </p>
                  </div>
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-primary/10">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-primary via-sky-400 to-cyan-400" />
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-3 rounded-[1.5rem] border border-border/60 bg-background/75 p-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_auto] xl:items-end">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Target Language
                </p>
                <Select value={targetLang} onValueChange={setTargetLang}>
                  <SelectTrigger className="mt-2 h-11 rounded-xl border-border/70 bg-background/90 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((language) => (
                      <SelectItem key={language.value} value={language.value}>
                        {language.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Export Format
                </p>
                <Select
                  value={exportFormat}
                  onValueChange={(value) =>
                    setExportFormat(value as ExportFormat)
                  }
                >
                  <SelectTrigger className="mt-2 h-11 rounded-xl border-border/70 bg-background/90 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="same">Same as source</SelectItem>
                    <SelectItem value="docx">
                      Word document - better fidelity
                    </SelectItem>
                    <SelectItem value="pdf">PDF document</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:w-auto xl:min-w-[14rem]">
                <Button
                  className="h-11 rounded-2xl"
                  onClick={() => void handleTranslate()}
                  disabled={translating || !docId}
                >
                  {translating ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      Translating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Translate
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="h-11 rounded-2xl"
                  onClick={() => void handleExport()}
                  disabled={exporting || !exportStatus?.ready_to_export}
                >
                  {exporting ? (
                    <Spinner className="mr-2 h-4 w-4" />
                  ) : null}
                  Export
                </Button>
              </div>
            </div>
          </Reveal>
        </section>

        {exportStatus &&
          (exportStatus.pending > 0 ||
            exportStatus.translation_errors > 0 ||
            exportStatus.warning) && (
            <div className="rounded-2xl border border-amber-300/60 bg-amber-100/75 px-5 py-4 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-200">
              {exportStatus.warning ??
                `${exportStatus.pending} pending segment${exportStatus.pending === 1 ? "" : "s"} and ${exportStatus.translation_errors} translation error${exportStatus.translation_errors === 1 ? "" : "s"} still need attention before export.`}
            </div>
          )}

        {segments.some(
          (segment) =>
            segment.glossary_violations &&
            segment.glossary_violations.length > 0,
        ) && (
          <Reveal className="glass-panel flex items-center gap-3 rounded-[1.5rem] border border-amber-300/60 bg-amber-100/75 px-5 py-4 dark:border-amber-800/60 dark:bg-amber-950/35">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Some segments contain glossary term violations. They are
              highlighted inline for faster review.
            </p>
          </Reveal>
        )}

        {loading ? (
          <div className="glass-panel motion-fade-in flex flex-col items-center gap-4 rounded-[2rem] py-24">
            <Spinner className="h-8 w-8 text-primary" />
            <p className="text-sm text-muted-foreground">Loading segments...</p>
          </div>
        ) : segments.length === 0 ? (
          <div className="glass-panel flex flex-col items-center gap-3 rounded-[2rem] py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <Languages className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold text-foreground">
              No segments found
            </p>
            <p className="max-w-md text-sm leading-7 text-muted-foreground">
              Try another filter or run translation to populate this document
              with segments.
            </p>
          </div>
        ) : (
          <motion.section layout className="space-y-4 overflow-hidden">
            <AnimatePresence mode="popLayout">
              {segments.map((segment, index) => (
                <SegmentRow
                  key={`${segment.segment_id}-${index}`}
                  segment={segment}
                  selected={selectedIds.has(segment.segment_id)}
                  onSelect={toggleSelect}
                  onApprove={handleApprove}
                  onUpdateOutput={handleUpdateOutput}
                  onUpdateSource={handleUpdateSource}
                  onRetry={handleRetry}
                  retrying={retryingId === segment.segment_id}
                />
              ))}
            </AnimatePresence>
          </motion.section>
        )}
      </div>
    </AppShell>
  );
}

export default function TranslatePage() {
  return (
    <Suspense>
      <TranslatePageContent />
    </Suspense>
  );
}
