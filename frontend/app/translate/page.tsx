"use client";

import { useEffect, useState, Suspense } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  Globe,
  Languages,
  Lightbulb,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HoverCard, Reveal } from "@/components/motion/primitives";
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
  translateDocument,
  type ExportFormat,
  type ExportStatusResponse,
  type Segment,
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
const CUSTOM_SEGMENT_PREFIX = "custom-segment";

type WorkspaceSegment = Segment & {
  localOnly?: boolean;
  sourceEdited?: boolean;
};

type LocalWorkspaceState = {
  customSegments: WorkspaceSegment[];
  sourceOverrides: Record<string, string>;
  outputOverrides: Record<string, string>;
};

function getWorkspaceStorageKey(documentId: string) {
  return `translation-studio-workspace:${documentId}`;
}

function readLocalWorkspaceState(documentId: string): LocalWorkspaceState {
  if (typeof window === "undefined" || !documentId) {
    return { customSegments: [], sourceOverrides: {}, outputOverrides: {} };
  }

  try {
    const raw = window.localStorage.getItem(getWorkspaceStorageKey(documentId));
    if (!raw) {
      return { customSegments: [], sourceOverrides: {}, outputOverrides: {} };
    }

    const parsed = JSON.parse(raw) as Partial<LocalWorkspaceState>;

    return {
      customSegments: Array.isArray(parsed.customSegments)
        ? parsed.customSegments
        : [],
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
    return { customSegments: [], sourceOverrides: {}, outputOverrides: {} };
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

        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          {editingMode !== "none" ? (
            <>
              <Button
                size="icon-sm"
                onClick={handleSave}
                className="rounded-xl"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                onClick={handleCancel}
                className="rounded-xl"
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
                disabled={retrying || segment.localOnly}
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
                className="rounded-xl"
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
            {segment.localOnly && (
              <Badge variant="outline" className="rounded-full text-[10px]">
                Local custom segment
              </Badge>
            )}
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
          {segment.localOnly && (
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              This custom segment is local to the workspace. The current backend
              does not expose segment creation yet, so it cannot be machine
              retranslated server-side.
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
  const [exportFormat, setExportFormat] = useState<ExportFormat>("same");
  const [exporting, setExporting] = useState(false);
  const [sourceOverrides, setSourceOverrides] = useState<Record<string, string>>(
    {},
  );
  const [outputOverrides, setOutputOverrides] = useState<Record<string, string>>(
    {},
  );
  const [customSegments, setCustomSegments] = useState<WorkspaceSegment[]>([]);
  const [customSourceText, setCustomSourceText] = useState("");
  const [showCustomSegmentForm, setShowCustomSegmentForm] = useState(false);

  const selectableIds = segments.map((segment) => segment.segment_id);
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((segmentId) => selectedIds.has(segmentId));

  useEffect(() => {
    if (!docId) return;

    const storedState = readLocalWorkspaceState(docId);
    setSourceOverrides(storedState.sourceOverrides);
    setOutputOverrides(storedState.outputOverrides);
    setCustomSegments(storedState.customSegments);
  }, [docId]);

  useEffect(() => {
    if (!docId) return;

    persistLocalWorkspaceState(docId, {
      customSegments,
      sourceOverrides,
      outputOverrides,
    });
  }, [customSegments, docId, outputOverrides, sourceOverrides]);

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
            final_text:
              outputOverrides[segment.segment_id] ?? segment.final_text,
            sourceEdited: Boolean(sourceOverrides[segment.segment_id]),
          }));

      setSegments([...customSegments, ...normalizedSegments]);
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
  }, [customSegments, docId, outputOverrides, sourceOverrides, statusFilter]);

  useEffect(() => {
    if (!docId) {
      setExportStatus(null);
      return;
    }

    getExportStatus(docId)
      .then((data) => setExportStatus(data))
      .catch(() => setExportStatus(null));
  }, [docId, segments]);

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

    const customSegment = customSegments.find(
      (segment) => segment.segment_id === segmentId,
    );

    if (customSegment) {
      setSegments((prev) =>
        prev.map((segment) =>
          segment.segment_id === segmentId ? customSegment : segment,
        ),
      );
      return;
    }

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

    setTranslating(true);
    setTranslationMessage(null);

    try {
      const data = await translateDocument(docId, targetLang, []);
      await loadSegments(statusFilter);
      const exportData = await getExportStatus(docId).catch(() => null);
      setExportStatus(exportData);
      setTranslationMessage(
        `${data.segments_translated} new segments translated`,
      );
      toast({
        title: "Translation complete",
        description: `${data.segments_translated} new segments translated.`,
      });
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
    if (segment.localOnly) {
      toast({
        title: "Local segment only",
        description:
          "Custom segments live only in the frontend workspace right now and cannot be retranslated by the backend.",
      });
      return;
    }

    if (sourceOverrides[segment.segment_id]) {
      toast({
        title: "Source edit is local",
        description:
          "This retranslation uses the backend's original source segment. Your source edit stays in the frontend workspace only.",
      });
    }

    setRetryingId(segment.segment_id);
    try {
      await translateDocument(docId, targetLang, [], [segment.segment_id]);
      await refreshSingleSegment(segment.segment_id);
      const exportData = await getExportStatus(docId).catch(() => null);
      setExportStatus(exportData);
      toast({
        title: "Segment retried",
        description: "The failed segment was sent back for translation.",
      });
    } catch {
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
  ) => {
    const segmentId = segment.segment_id;

    if (segment.localOnly) {
      setCustomSegments((prev) =>
        prev.map((segment) =>
          segment.segment_id === segmentId
            ? { ...segment, final_text: finalText, status: "approved" }
            : segment,
        ),
      );
      setOutputOverrides((prev) => ({ ...prev, [segmentId]: finalText }));
      setSegments((prev) =>
        prev.map((segment) =>
          segment.segment_id === segmentId
            ? { ...segment, final_text: finalText, status: "approved" }
            : segment,
        ),
      );
      toast({
        title: "Local segment approved",
        description:
          "The custom segment was saved in the current workspace only.",
      });
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
      toast({
        title: "Segment approved",
        description: "Correction saved and learning triggered.",
      });
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
    setCustomSegments((prev) =>
      prev.map((segment) =>
        segment.segment_id === segmentId
          ? { ...segment, final_text: finalText }
          : segment,
      ),
    );
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
    setCustomSegments((prev) =>
      prev.map((segment) =>
        segment.segment_id === segmentId
          ? { ...segment, source_text: sourceText, sourceEdited: true }
          : segment,
      ),
    );
    setSegments((prev) =>
      prev.map((segment) =>
        segment.segment_id === segmentId
          ? { ...segment, source_text: sourceText, sourceEdited: true }
          : segment,
      ),
    );
  };

  const handleAddCustomSegment = () => {
    const value = customSourceText.trim();

    if (!value) {
      toast({
        title: "Custom text is empty",
        description: "Add some source text before creating a custom segment.",
        variant: "destructive",
      });
      return;
    }

    const customSegment: WorkspaceSegment = {
      segment_id: `${CUSTOM_SEGMENT_PREFIX}-${crypto.randomUUID()}`,
      source_text: value,
      translated_text: "",
      final_text: "",
      status: "pending",
      type: "sentence",
      tm_match_type: null,
      tm_suggestions: [],
      glossary_violations: [],
      format_snapshot: null,
      row: null,
      col: null,
      localOnly: true,
      sourceEdited: true,
    };

    setCustomSegments((prev) => [customSegment, ...prev]);
    setSegments((prev) => [customSegment, ...prev]);
    setCustomSourceText("");
    setShowCustomSegmentForm(false);
    toast({
      title: "Custom segment added",
      description:
        "The segment was added to this workspace. It is local until backend support exists for saving new segments.",
    });
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
    for (const id of selectedIds) {
      const segment = segments.find((item) => item.segment_id === id);
      if (segment)
        await handleApprove(
          segment,
          segment.final_text || segment.translated_text,
        );
    }
    setSelectedIds(new Set());
    toast({ title: `${selectedIds.size} segments approved` });
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
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8 lg:py-8">
            <div>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
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

              <div className="mt-6 grid gap-3 xl:grid-cols-3">
                <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-background/75 px-4 py-3">
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Target Language
                    </p>
                    <Select value={targetLang} onValueChange={setTargetLang}>
                      <SelectTrigger className="mt-2 h-11 rounded-xl border-border/70 bg-background/90 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((language) => (
                          <SelectItem
                            key={language.value}
                            value={language.value}
                          >
                            {language.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => void handleTranslate()}
                    disabled={translating || !docId}
                    className="h-11 rounded-2xl px-5"
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
                    className="h-11 rounded-2xl border-border/70 bg-background/80 px-4"
                    onClick={() => void loadSegments(statusFilter)}
                    disabled={loading}
                  >
                    <RefreshCw
                      className={cn("h-4 w-4", loading && "animate-spin")}
                    />
                  </Button>
                </div>

                <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/60 bg-background/75 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
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
                  <Button
                    variant="outline"
                    className="h-11 rounded-2xl sm:shrink-0"
                    onClick={() => void handleExport()}
                    disabled={exporting || !exportStatus?.ready_to_export}
                    title={
                      exportFormat === "docx"
                        ? "Recommended for stronger layout fidelity."
                        : undefined
                    }
                  >
                    {exporting ? (
                      <Spinner className="mr-2 h-4 w-4" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Export
                  </Button>
                  {!exportStatus?.ready_to_export && exportStatus && (
                    <Button
                      variant="ghost"
                      className="h-11 rounded-2xl sm:shrink-0"
                      onClick={() => void handleExport()}
                      disabled={exporting}
                    >
                      Export Anyway
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  label: "Review progress",
                  value: `${progress}%`,
                  note: `${completedCount}/${segments.length} completed`,
                },
                {
                  label: "Approved",
                  value: `${approvedCount}`,
                  note: "Finalized and learned",
                },
                {
                  label: "Pending",
                  value: `${pendingCount}`,
                  note: "Needs review",
                },
                {
                  label: "Attention needed",
                  value: `${flaggedCount}`,
                  note: "Errors or glossary alerts",
                },
              ].map((item, index) => (
                <HoverCard
                  key={item.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ duration: 0.45, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-[1.5rem] border border-border/60 bg-background/78 p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.55)]"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
                    {item.value}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.note}
                  </p>
                </HoverCard>
              ))}
            </div>
          </div>
        </Reveal>

        <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
          <Reveal delay={0.05} className="glass-panel self-start rounded-[1.75rem] border border-border/70 p-5">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Review Controls
                </p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Filter the queue, keep an eye on progress, and process
                  segments in focused batches.
                </p>
              </div>

              <div className="w-full rounded-2xl border border-border/60 bg-background/75 p-4 sm:max-w-sm">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>Completion</span>
                  <span className="font-mono">
                    {completedCount}/{segments.length}
                  </span>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary via-sky-400 to-cyan-400 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="rounded-full"
                onClick={handleSelectAll}
              >
                {allSelected ? "Clear Selection" : "Select All"}
              </Button>
              {selectedIds.size > 0 && (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void handleBulkApprove()}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Bulk Accept ({selectedIds.size})
                </Button>
              )}
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => void handleShare()}
                disabled={!docId}
              >
                <Copy className="mr-2 h-4 w-4" />
                Share
              </Button>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => setShowCustomSegmentForm((value) => !value)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Custom Segment
              </Button>
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
                      "rounded-full border px-4 py-2 text-sm font-medium capitalize transition-all duration-200",
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

            {showCustomSegmentForm && (
              <div className="mt-5 rounded-[1.5rem] border border-border/60 bg-background/75 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Custom Segment
                </p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Add local source text to this workspace. It will appear in the
                  same document review flow.
                </p>
                <Textarea
                  value={customSourceText}
                  onChange={(event) => setCustomSourceText(event.target.value)}
                  placeholder="Add custom source text..."
                  className="mt-4 min-h-28 rounded-2xl border-border/70 bg-background/90"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    className="rounded-2xl"
                    onClick={handleAddCustomSegment}
                  >
                    Save Segment
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-2xl"
                    onClick={() => {
                      setCustomSourceText("");
                      setShowCustomSegmentForm(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                <p className="mt-3 text-xs leading-6 text-muted-foreground">
                  This is currently a frontend-only segment because the backend
                  does not yet expose segment creation.
                </p>
              </div>
            )}

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
          </Reveal>

          <Reveal delay={0.1} className="glass-panel self-start rounded-[1.75rem] border border-border/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Legend
            </p>
            <div className="mt-4 space-y-3">
              {(["pending", "reviewed", "approved"] as const).map((status) => (
                <div
                  key={status}
                  className="motion-card-subtle flex items-center justify-between rounded-2xl border border-border/60 bg-background/70 px-3 py-2"
                >
                  <span className="text-sm text-foreground capitalize">
                    {status}
                  </span>
                  <StatusPill status={status} />
                </div>
              ))}
            </div>

            <div className="motion-card-subtle mt-5 rounded-2xl border border-border/60 bg-background/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                TM Match Types
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <TmMatchBadge tmMatchType="exact" />
                <TmMatchBadge tmMatchType="fuzzy" />
                <TmMatchBadge tmMatchType="new" />
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
