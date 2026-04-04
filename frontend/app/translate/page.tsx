"use client";

import { memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  LayoutGrid,
  Languages,
  Lightbulb,
  List,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Table2,
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  { value: "en", label: "English (en)" },
];

const STATUS_FILTERS = ["all", "pending", "reviewed", "approved"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const VISIBLE_TYPES = new Set(["sentence", "heading", "table_cell"]);
const VIEW_MODES = ["cards", "compact", "table"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const TABLE_PAGE_SIZE_OPTIONS = [6, 10, 15, 20] as const;
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

function getSegmentOutputText(segment: Pick<Segment, "final_text" | "translated_text">) {
  return segment.final_text || segment.translated_text || "";
}

function hasTranslatedOutput(
  segment: Pick<Segment, "final_text" | "translated_text">,
) {
  return Boolean(getSegmentOutputText(segment).trim());
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
        "border-slate-400/80 bg-slate-100/95 text-slate-700 dark:border-slate-600/90 dark:bg-slate-900/80 dark:text-slate-200",
    },
    reviewed: {
      label: "Reviewed",
      className:
        "border-amber-400/80 bg-amber-100/95 text-amber-800 dark:border-amber-700/90 dark:bg-amber-950/65 dark:text-amber-200",
    },
    approved: {
      label: "Approved",
      className:
        "border-emerald-400/80 bg-emerald-100/95 text-emerald-800 dark:border-emerald-700/90 dark:bg-emerald-950/65 dark:text-emerald-200",
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

const INITIAL_SEGMENT_BATCH = 24;
const SEGMENT_BATCH_SIZE = 16;

const SegmentRow = memo(
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
    const [editingMode, setEditingMode] = useState<
      "none" | "source" | "output"
    >("none");
    const [sourceValue, setSourceValue] = useState(segment.source_text);
    const [outputValue, setOutputValue] = useState(
      segment.final_text || segment.translated_text,
    );
    const [approving, setApproving] = useState(false);
    const [showTM, setShowTM] = useState(false);

    useEffect(() => {
      setSourceValue(segment.source_text);
      setOutputValue(getSegmentOutputText(segment));
    }, [segment.source_text, segment.final_text, segment.translated_text]);

    const canApprove = hasTranslatedOutput(segment);
    const isApproved = segment.status === "approved";

    const statusAccentMap: Record<string, string> = {
      pending: "before:bg-slate-400",
      reviewed: "before:bg-amber-400",
      approved: "before:bg-emerald-400",
    };

    const handleApprove = async () => {
      if (!canApprove) return;
      setApproving(true);
      await onApprove(segment, outputValue);
      setEditingMode("none");
      setApproving(false);
    };

    const handleEditSource = () => {
      if (isApproved) return;
      setSourceValue(segment.source_text);
      setEditingMode("source");
    };

    const handleEditOutput = () => {
      if (isApproved) return;
      setOutputValue(getSegmentOutputText(segment));
      setEditingMode("output");
    };

    const handleCancel = () => {
      setSourceValue(segment.source_text);
      setOutputValue(getSegmentOutputText(segment));
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
        style={{
          contentVisibility: "auto",
          containIntrinsicSize: "420px",
        }}
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
              disabled={isApproved}
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
                {isTableCell &&
                  segment.row !== null &&
                  segment.col !== null && (
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
                {!isApproved ? (
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
                ) : null}
                {!isApproved && canApprove ? (
                  <Button
                    size="icon-sm"
                    onClick={handleApprove}
                    disabled={approving || isApproved}
                    className="rounded-xl justify-center"
                  >
                    {approving ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </Button>
                ) : null}
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
              <div className="flex flex-wrap items-center gap-2">
                {!isApproved ? (
                  <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
                    Double-click to edit
                  </span>
                ) : null}
                {segment.sourceEdited && (
                  <Badge variant="outline" className="rounded-full text-[10px]">
                    Local source edit
                  </Badge>
                )}
              </div>
            </div>
            {editingMode === "source" ? (
              <Textarea
                value={sourceValue}
                onChange={(e) => setSourceValue(e.target.value)}
                className="min-h-[144px] resize-none rounded-2xl border-border/70 bg-background/90 text-sm leading-7"
                autoFocus
              />
            ) : (
              <p
                onDoubleClick={handleEditSource}
                className={cn(
                  "break-words text-foreground",
                  sourceTextClass,
                  !isApproved &&
                    "cursor-text rounded-xl transition-colors hover:bg-muted/35 hover:px-2 hover:py-1",
                )}
              >
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
              {!isApproved ? (
                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
                  Double-click to edit
                </span>
              ) : null}
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
                onDoubleClick={handleEditOutput}
                className={cn(
                  "break-words",
                  outputTextClass,
                  !isApproved &&
                    "cursor-text rounded-xl transition-colors hover:bg-muted/35 hover:px-2 hover:py-1",
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
  },
  (prevProps, nextProps) =>
    prevProps.segment === nextProps.segment &&
    prevProps.selected === nextProps.selected &&
    prevProps.retrying === nextProps.retrying,
);

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
    visibleByDocument: {},
    receivedDocumentIds: [],
  });
  const [exportFormat, setExportFormat] = useState<ExportFormat>("same");
  const [exporting, setExporting] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_SEGMENT_BATCH);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState<number>(6);
  const [inlineEditState, setInlineEditState] = useState<{
    segmentId: string;
    field: "source" | "output";
    value: string;
  } | null>(null);
  const [sourceOverrides, setSourceOverrides] = useState<
    Record<string, string>
  >({});
  const [outputOverrides, setOutputOverrides] = useState<
    Record<string, string>
  >({});
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  // Keep a ref to the current targetLang so memoized SegmentRow callbacks
  // always read the latest value (avoids stale closure in handleRetry).
  
  const targetLangRef = useRef(targetLang);
  useEffect(() => {
    targetLangRef.current = targetLang;
  }, [targetLang]);

  const filteredSegments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return segments;

    return segments.filter((segment) => {
      const haystack = [
        segment.segment_id,
        segment.source_text,
        segment.translated_text,
        segment.final_text ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [searchQuery, segments]);
  const selectableIds = filteredSegments
    .filter((segment) => segment.status !== "approved")
    .map((segment) => segment.segment_id);
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((segmentId) => selectedIds.has(segmentId));
  const selectedApprovableCount = Array.from(selectedIds).filter((id) => {
    const segment = segments.find((item) => item.segment_id === id);
    return Boolean(
      segment &&
        segment.status !== "approved" &&
        hasTranslatedOutput(segment),
    );
  }).length;
  const nonCardPageSize = viewMode === "table" ? tablePageSize : 10;
  const pageCount = Math.max(
    1,
    Math.ceil(filteredSegments.length / nonCardPageSize),
  );
  const paginatedSegments = filteredSegments.slice(
    (currentPage - 1) * nonCardPageSize,
    currentPage * nonCardPageSize,
  );
  const visibleSegments =
    viewMode === "cards"
      ? filteredSegments.slice(0, visibleCount)
      : paginatedSegments;
  const hasMoreSegments =
    viewMode === "cards" && visibleCount < filteredSegments.length;
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
    setVisibleCount(INITIAL_SEGMENT_BATCH);
  }, [docId, statusFilter, segments.length]);

  useEffect(() => {
    setCurrentPage(1);
  }, [docId, statusFilter, searchQuery, viewMode]);

  useEffect(() => {
    if (viewMode !== "cards" || visibleCount >= filteredSegments.length) return;

    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setVisibleCount((current) =>
            Math.min(current + SEGMENT_BATCH_SIZE, filteredSegments.length),
          );
        }
      },
      {
        rootMargin: "800px 0px",
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [filteredSegments.length, viewMode, visibleCount]);

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
      setShareOverview({
        ownedByDocument: {},
        visibleByDocument: {},
        receivedDocumentIds: [],
      });
      return;
    }

    getShareOverview()
      .then((data) => setShareOverview(data))
      .catch(() =>
        setShareOverview({
          ownedByDocument: {},
          visibleByDocument: {},
          receivedDocumentIds: [],
        }),
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
    const segmentIds = Array.from(selectedIds).filter((id) => {
      const segment = segments.find((item) => item.segment_id === id);
      return Boolean(segment && segment.status !== "approved");
    });

    if (segmentIds.length === 0) {
      setTranslationMessage("Select one or more non-approved segments to translate.");
      toast({
        title: "No eligible segments selected",
        description: "Choose segments that are not already approved.",
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
      await translateDocument(docId, targetLangRef.current, [], [segment.segment_id]);
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
    options?: { silentSuccess?: boolean; skipConfirm?: boolean },
  ) => {
    const segmentId = segment.segment_id;

    if (
      !options?.skipConfirm &&
      typeof window !== "undefined" &&
      !window.confirm(
        "Approve this segment? This action is final and cannot be undone.",
      )
    ) {
      return;
    }

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
    const segment = segments.find((item) => item.segment_id === id);
    if (segment?.status === "approved") return;

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkApprove = async () => {
    const approvableSegments = Array.from(selectedIds)
      .map((id) => segments.find((item) => item.segment_id === id))
      .filter((segment): segment is WorkspaceSegment => {
        if (!segment) return false;
        return hasTranslatedOutput(segment) && segment.status !== "approved";
      });
    const count = approvableSegments.length;

    if (
      count > 0 &&
      typeof window !== "undefined" &&
      !window.confirm(
        `Approve ${count} segment${count === 1 ? "" : "s"}? These changes cannot be undone.`,
      )
    ) {
      return;
    }

    for (const segment of approvableSegments) {
      await handleApprove(segment, getSegmentOutputText(segment), {
        silentSuccess: true,
        skipConfirm: true,
      });
    }
    setSelectedIds(new Set());
    if (count > 0) {
      toast({ title: `${count} segments approved` });
    } else {
      toast({
        title: "No translated segments selected",
        description: "Only translated segments can be approved.",
        variant: "destructive",
      });
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

  const handleOpenInlineEdit = (
    segment: WorkspaceSegment,
    field: "source" | "output",
  ) => {
    if (segment.status === "approved") return;

    setInlineEditState({
      segmentId: segment.segment_id,
      field,
      value:
        field === "source"
          ? segment.source_text
          : getSegmentOutputText(segment),
    });
  };

  const handleSaveInlineEdit = () => {
    if (!inlineEditState) return;

    if (inlineEditState.field === "source") {
      handleUpdateSource(inlineEditState.segmentId, inlineEditState.value);
    } else {
      handleUpdateOutput(inlineEditState.segmentId, inlineEditState.value);
    }

    toast({
      title:
        inlineEditState.field === "source" ? "Source updated" : "Output updated",
      description: "The segment was updated in your workspace.",
    });
    setInlineEditState(null);
  };

  const handleCancelInlineEdit = () => {
    setInlineEditState(null);
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
    docId && shareOverview.visibleByDocument[docId]
      ? shareOverview.visibleByDocument[docId].participants
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
                      Shared access
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
                                  {recipient.name ||
                                    (recipient.role === "owner"
                                      ? "Owner"
                                      : "Collaborator")}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {recipient.email || "No email available"}
                                </p>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className="rounded-full text-[10px] font-semibold uppercase tracking-[0.16em]"
                            >
                              {recipient.role === "owner" ? "Owner" : "Shared"}
                            </Badge>
                          </HoverCardContent>
                        </ProfileHoverCard>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[16rem] items-center justify-center px-8">
                    <p className="max-w-xs text-center text-sm leading-7 text-slate-500 dark:text-slate-400">
                      Once this document is shared, everyone who opens it will
                      appear here so collaborators can see the same presence
                      view.
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
                {selectedApprovableCount > 0 && (
                  <Button
                    variant="outline"
                    className="h-10 rounded-full"
                    onClick={() => void handleBulkApprove()}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Bulk Accept ({selectedApprovableCount})
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
                  const filterTone =
                    filter === "approved"
                      ? "border-emerald-300/80 text-emerald-700 hover:border-emerald-400 dark:border-emerald-800/80 dark:text-emerald-200 dark:hover:border-emerald-700"
                      : filter === "reviewed"
                        ? "border-amber-300/80 text-amber-700 hover:border-amber-400 dark:border-amber-800/80 dark:text-amber-200 dark:hover:border-amber-700"
                        : filter === "pending"
                          ? "border-slate-300/80 text-slate-700 hover:border-slate-400 dark:border-slate-700/80 dark:text-slate-200 dark:hover:border-slate-500"
                          : "border-primary/35 text-primary hover:border-primary/50 dark:border-primary/40 dark:text-primary";
                  return (
                    <button
                      key={filter}
                      onClick={() => setStatusFilter(filter)}
                      className={cn(
                        "min-w-0 rounded-full border px-4 py-2 text-sm font-medium capitalize transition-all duration-200",
                        statusFilter === filter
                          ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-sky-500/15"
                          : cn(
                              "bg-background/70",
                              filterTone,
                            ),
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

            <div className="mt-4 grid gap-3 rounded-[1.5rem] border border-border/60 bg-background/75 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Search Segments
                </p>
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search source or translated text..."
                  className="mt-2 h-11 rounded-xl border-border/70 bg-background/90"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "cards", label: "Normal", icon: LayoutGrid },
                    { id: "compact", label: "Compact", icon: List },
                    { id: "table", label: "Table", icon: Table2 },
                  ] as const
                ).map((view) => (
                  <button
                    key={view.id}
                    onClick={() => setViewMode(view.id)}
                    className={cn(
                      "inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors",
                      viewMode === view.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 bg-background/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    <view.icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{view.label}</span>
                  </button>
                ))}
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
                  {exporting ? <Spinner className="mr-2 h-4 w-4" /> : null}
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
        ) : filteredSegments.length === 0 ? (
          <div className="glass-panel flex flex-col items-center gap-3 rounded-[2rem] py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <Languages className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold text-foreground">
              No matching segments
            </p>
            <p className="max-w-md text-sm leading-7 text-muted-foreground">
              Try a different search term or change the current status filter.
            </p>
          </div>
        ) : (
          <>
            {viewMode === "cards" ? (
              <motion.section layout className="space-y-4 overflow-hidden">
                <AnimatePresence mode="popLayout">
                  {visibleSegments.map((segment, index) => (
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
                {hasMoreSegments ? (
                  <div
                    ref={loadMoreRef}
                    className="glass-panel flex items-center justify-between rounded-[1.4rem] border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground"
                  >
                    <span>
                      Rendering {visibleSegments.length} of{" "}
                      {filteredSegments.length} segments
                    </span>
                    <Spinner className="h-4 w-4 text-primary" />
                  </div>
                ) : null}
              </motion.section>
            ) : viewMode === "compact" ? (
              <div className="glass-panel overflow-hidden rounded-[1.75rem] border border-border/70">
                <div className="divide-y divide-border/60">
                  {visibleSegments.map((segment) => (
                    <div
                      key={segment.segment_id}
                      className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(segment.segment_id)}
                            onChange={() => toggleSelect(segment.segment_id)}
                            disabled={segment.status === "approved"}
                            className="h-4 w-4 rounded accent-primary"
                          />
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            {segment.segment_id}
                          </p>
                          <StatusPill status={segment.status} />
                          <TmMatchBadge tmMatchType={segment.tm_match_type} />
                        </div>
                        {inlineEditState?.segmentId === segment.segment_id &&
                        inlineEditState.field === "source" ? (
                          <div className="mt-3 space-y-2">
                            <Textarea
                              value={inlineEditState.value}
                              onChange={(event) =>
                                setInlineEditState((current) =>
                                  current
                                    ? { ...current, value: event.target.value }
                                    : current,
                                )
                              }
                              className="min-h-28 rounded-2xl border-border/70 bg-background/90 text-sm leading-7"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="rounded-xl"
                                onClick={handleSaveInlineEdit}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-xl"
                                onClick={handleCancelInlineEdit}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p
                            onDoubleClick={() =>
                              handleOpenInlineEdit(segment, "source")
                            }
                            className={cn(
                              "mt-3 line-clamp-2 text-sm leading-7 text-foreground",
                              segment.status !== "approved" &&
                                "cursor-text rounded-xl transition-colors hover:bg-muted/35 hover:px-2 hover:py-1",
                            )}
                          >
                            {segment.source_text}
                          </p>
                        )}
                        {inlineEditState?.segmentId === segment.segment_id &&
                        inlineEditState.field === "output" ? (
                          <div className="mt-2 space-y-2">
                            <Textarea
                              value={inlineEditState.value}
                              onChange={(event) =>
                                setInlineEditState((current) =>
                                  current
                                    ? { ...current, value: event.target.value }
                                    : current,
                                )
                              }
                              className="min-h-28 rounded-2xl border-border/70 bg-background/90 text-sm leading-7"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="rounded-xl"
                                onClick={handleSaveInlineEdit}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-xl"
                                onClick={handleCancelInlineEdit}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p
                            onDoubleClick={() =>
                              handleOpenInlineEdit(segment, "output")
                            }
                            className={cn(
                              "mt-2 line-clamp-2 text-sm leading-7 text-muted-foreground",
                              segment.status !== "approved" &&
                                "cursor-text rounded-xl transition-colors hover:bg-muted/35 hover:px-2 hover:py-1",
                            )}
                          >
                            {getSegmentOutputText(segment) ||
                              "Not yet translated"}
                          </p>
                        )}
                      </div>
                      {segment.status !== "approved" ? (
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <Button
                            size="icon-sm"
                            variant="outline"
                            className="rounded-xl border-amber-300/80 text-amber-700 hover:bg-amber-100/80 dark:border-amber-900/70 dark:text-amber-200 dark:hover:bg-amber-950/50"
                            onClick={() => void handleRetry(segment)}
                            disabled={retryingId === segment.segment_id}
                            title="Retranslate segment"
                            aria-label={`Retranslate segment ${segment.segment_id}`}
                          >
                            {retryingId === segment.segment_id ? (
                              <Spinner className="h-3.5 w-3.5" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          {hasTranslatedOutput(segment) ? (
                            <Button
                              size="icon-sm"
                              variant="outline"
                              className="rounded-xl border-emerald-300/80 text-emerald-700 hover:bg-emerald-100/80 dark:border-emerald-900/70 dark:text-emerald-200 dark:hover:bg-emerald-950/50"
                              onClick={() =>
                                void handleApprove(
                                  segment,
                                  getSegmentOutputText(segment),
                                )
                              }
                              title="Approve translation"
                              aria-label={`Approve segment ${segment.segment_id}`}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex items-start lg:justify-end">
                          <Badge
                            variant="outline"
                            className="rounded-full border-emerald-300/80 bg-emerald-100/80 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/45 dark:text-emerald-200"
                          >
                            Locked
                          </Badge>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="glass-panel overflow-hidden rounded-2xl border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[64px]">Select</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Output</TableHead>
                      <TableHead className="w-[180px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleSegments.map((segment) => (
                      <TableRow key={segment.segment_id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(segment.segment_id)}
                            onChange={() => toggleSelect(segment.segment_id)}
                            disabled={segment.status === "approved"}
                            className="h-4 w-4 rounded accent-primary"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <StatusPill status={segment.status} />
                            <TmMatchBadge tmMatchType={segment.tm_match_type} />
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[360px] whitespace-normal">
                          {inlineEditState?.segmentId === segment.segment_id &&
                          inlineEditState.field === "source" ? (
                            <div className="space-y-2">
                              <Textarea
                                value={inlineEditState.value}
                                onChange={(event) =>
                                  setInlineEditState((current) =>
                                    current
                                      ? { ...current, value: event.target.value }
                                      : current,
                                  )
                                }
                                className="min-h-24 rounded-2xl border-border/70 bg-background/90 text-sm leading-7"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="rounded-xl"
                                  onClick={handleSaveInlineEdit}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-xl"
                                  onClick={handleCancelInlineEdit}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p
                              onDoubleClick={() =>
                                handleOpenInlineEdit(segment, "source")
                              }
                              className={cn(
                                "line-clamp-3 text-sm leading-7 text-foreground",
                                segment.status !== "approved" &&
                                  "cursor-text rounded-xl transition-colors hover:bg-muted/35 hover:px-2 hover:py-1",
                              )}
                            >
                              {segment.source_text}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[360px] whitespace-normal">
                          {inlineEditState?.segmentId === segment.segment_id &&
                          inlineEditState.field === "output" ? (
                            <div className="space-y-2">
                              <Textarea
                                value={inlineEditState.value}
                                onChange={(event) =>
                                  setInlineEditState((current) =>
                                    current
                                      ? { ...current, value: event.target.value }
                                      : current,
                                  )
                                }
                                className="min-h-24 rounded-2xl border-border/70 bg-background/90 text-sm leading-7"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="rounded-xl"
                                  onClick={handleSaveInlineEdit}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-xl"
                                  onClick={handleCancelInlineEdit}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p
                              onDoubleClick={() =>
                                handleOpenInlineEdit(segment, "output")
                              }
                              className={cn(
                                "line-clamp-3 text-sm leading-7 text-muted-foreground",
                                segment.status !== "approved" &&
                                  "cursor-text rounded-xl transition-colors hover:bg-muted/35 hover:px-2 hover:py-1",
                              )}
                            >
                              {getSegmentOutputText(segment) ||
                                "Not yet translated"}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          {segment.status !== "approved" ? (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="icon-sm"
                                variant="outline"
                                className="rounded-xl border-amber-300/80 text-amber-700 hover:bg-amber-100/80 dark:border-amber-900/70 dark:text-amber-200 dark:hover:bg-amber-950/50"
                                onClick={() => void handleRetry(segment)}
                                disabled={retryingId === segment.segment_id}
                                title="Retranslate segment"
                                aria-label={`Retranslate segment ${segment.segment_id}`}
                              >
                                {retryingId === segment.segment_id ? (
                                  <Spinner className="h-3.5 w-3.5" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              {hasTranslatedOutput(segment) ? (
                                <Button
                                  size="icon-sm"
                                  variant="outline"
                                  className="rounded-xl border-emerald-300/80 text-emerald-700 hover:bg-emerald-100/80 dark:border-emerald-900/70 dark:text-emerald-200 dark:hover:bg-emerald-950/50"
                                  onClick={() =>
                                    void handleApprove(
                                      segment,
                                      getSegmentOutputText(segment),
                                    )
                                  }
                                  title="Approve translation"
                                  aria-label={`Approve segment ${segment.segment_id}`}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            <Badge
                              variant="outline"
                              className="rounded-full border-emerald-300/80 bg-emerald-100/80 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/45 dark:text-emerald-200"
                            >
                              Locked
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {viewMode !== "cards" ? (
              <div className="flex flex-col gap-3 rounded-[1.4rem] border border-border/70 bg-background/75 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <p className="text-sm text-muted-foreground">
                    Page {currentPage} of {pageCount} • Showing{" "}
                    {visibleSegments.length} of {filteredSegments.length}{" "}
                    segments
                  </p>
                  {viewMode === "table" ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        Rows
                      </span>
                      <Select
                        value={String(tablePageSize)}
                        onValueChange={(value) => {
                          setTablePageSize(Number(value));
                          setCurrentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-9 w-[88px] rounded-xl border-border/70 bg-background/90 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                            <SelectItem key={size} value={String(size)}>
                              {size}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={() =>
                      setCurrentPage((page) => Math.max(1, page - 1))
                    }
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={() =>
                      setCurrentPage((page) => Math.min(pageCount, page + 1))
                    }
                    disabled={currentPage === pageCount}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
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
