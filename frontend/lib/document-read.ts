import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { ensureAppTables } from '@/lib/db-ensure'
import { getDb } from '@/lib/db-index'
import { documentCollaborators, documents, segmentAssignments, segments } from '@/lib/db/schema'

const MISSING_INDEX = 10 ** 9

type MembershipRole = 'owner' | 'editor' | 'viewer'

function normalizeIndex(value: unknown) {
  return Number.isInteger(value) ? Number(value) : MISSING_INDEX
}

function compareSegments(
  left: { position?: Record<string, unknown> | null; row?: number | null; col?: number | null; id: string },
  right: { position?: Record<string, unknown> | null; row?: number | null; col?: number | null; id: string },
) {
  const leftPosition = left.position ?? {}
  const rightPosition = right.position ?? {}

  const checks: Array<[number, number]> = [
    [normalizeIndex(leftPosition.block_index), normalizeIndex(rightPosition.block_index)],
    [normalizeIndex(leftPosition.sentence_index), normalizeIndex(rightPosition.sentence_index)],
    [normalizeIndex(leftPosition.phrase_index), normalizeIndex(rightPosition.phrase_index)],
    [normalizeIndex(left.row), normalizeIndex(right.row)],
    [normalizeIndex(left.col), normalizeIndex(right.col)],
  ]

  for (const [a, b] of checks) {
    if (a !== b) return a - b
  }

  return left.id.localeCompare(right.id)
}

async function getDocumentMembership(documentId: string, clerkUserId: string): Promise<MembershipRole | null> {
  await ensureAppTables()
  const db = getDb()

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  })

  if (!doc) return null
  if (doc.userId === clerkUserId) return 'owner'

  const membership = await db.query.documentCollaborators.findFirst({
    where: and(
      eq(documentCollaborators.documentId, documentId),
      eq(documentCollaborators.collaboratorClerkUserId, clerkUserId),
    ),
  })

  return (membership?.role as MembershipRole | undefined) ?? null
}

export async function listVisibleDocumentsForUser(clerkUserId: string) {
  await ensureAppTables()
  const db = getDb()

  const collaboratorRows = await db.query.documentCollaborators.findMany({
    where: eq(documentCollaborators.collaboratorClerkUserId, clerkUserId),
  })
  const collaboratorDocIds = Array.from(new Set(collaboratorRows.map((row) => row.documentId)))
  const collaboratorMap = new Map(collaboratorRows.map((row) => [row.documentId, row]))

  const whereClause = collaboratorDocIds.length
    ? or(
        eq(documents.userId, clerkUserId),
        inArray(documents.id, collaboratorDocIds),
      )
    : eq(documents.userId, clerkUserId)

  const docs = await db.query.documents.findMany({
    where: whereClause,
    orderBy: desc(documents.createdAt),
  })

  if (!docs.length) {
    return []
  }

  const docIds = docs.map((doc) => doc.id)
  const statsRows = await db
    .select({
      documentId: segments.documentId,
      total: sql<number>`count(${segments.id})`,
      pending: sql<number>`sum(case when ${segments.status} = 'pending' then 1 else 0 end)`,
      reviewed: sql<number>`sum(case when ${segments.status} = 'reviewed' then 1 else 0 end)`,
      approved: sql<number>`sum(case when ${segments.status} = 'approved' then 1 else 0 end)`,
    })
    .from(segments)
    .where(inArray(segments.documentId, docIds))
    .groupBy(segments.documentId)

  const statsByDoc = new Map(
    statsRows.map((row) => [
      row.documentId,
      {
        total: Number(row.total ?? 0),
        pending: Number(row.pending ?? 0),
        reviewed: Number(row.reviewed ?? 0),
        approved: Number(row.approved ?? 0),
      },
    ]),
  )

  return docs.map((doc) => {
    const stats = statsByDoc.get(doc.id) ?? {
      total: 0,
      pending: 0,
      reviewed: 0,
      approved: 0,
    }
    const progress = stats.total
      ? Math.round((((stats.reviewed + stats.approved) / stats.total) * 100) * 10) / 10
      : 0

    return {
      id: doc.id,
      filename: doc.filename,
      file_type: doc.fileType,
      created_at: doc.createdAt?.toISOString() ?? null,
      blocks_count: Array.isArray(doc.blocks) ? doc.blocks.length : 0,
      segments: stats,
      translation_progress: progress,
      firebase_url: doc.firebaseUrl,
      owner_clerk_user_id: doc.userId,
      access_role:
        doc.userId === clerkUserId
          ? 'owner'
          : (collaboratorMap.get(doc.id)?.role ?? 'viewer'),
      is_owner: doc.userId === clerkUserId,
    }
  })
}

export async function getDocumentForUser(documentId: string, clerkUserId: string) {
  await ensureAppTables()
  const db = getDb()
  const role = await getDocumentMembership(documentId, clerkUserId)

  if (!role) {
    return null
  }

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  })

  if (!doc) {
    return null
  }

  return {
    id: doc.id,
    filename: doc.filename,
    file_type: doc.fileType,
    blocks: doc.blocks ?? [],
    created_at: doc.createdAt?.toISOString() ?? null,
    metadata: doc.metadataJson ?? {},
    firebase_url: doc.firebaseUrl,
  }
}

export async function listSegmentsForUser(
  documentId: string,
  clerkUserId: string,
  status?: string,
  segType?: string,
) {
  await ensureAppTables()
  const db = getDb()
  const role = await getDocumentMembership(documentId, clerkUserId)
  if (!role) {
    return null
  }

  const assignments = await db.query.segmentAssignments.findMany({
    where: eq(segmentAssignments.documentId, documentId),
  })
  const assignmentMap = new Map(assignments.map((item) => [item.segmentId, item]))

  const whereParts = [eq(segments.documentId, documentId)]
  if (status) {
    whereParts.push(eq(segments.status, status))
  }
  if (segType) {
    whereParts.push(eq(segments.type, segType))
  }

  if (role === 'editor') {
    const assignedSegmentIds = assignments
      .filter((item) => item.assignedToClerkUserId === clerkUserId)
      .map((item) => item.segmentId)

    if (!assignedSegmentIds.length) {
      return []
    }

    whereParts.push(inArray(segments.id, assignedSegmentIds))
  }

  const rows = await db.query.segments.findMany({
    where: and(...whereParts),
  })

  const sorted = [...rows].sort((a, b) =>
    compareSegments(
      { id: a.id, position: a.position, row: a.row, col: a.col },
      { id: b.id, position: b.position, row: b.row, col: b.col },
    ),
  )

  return sorted.map((segment) => {
    const assignment = assignmentMap.get(segment.id)
    return {
      id: segment.id,
      document_id: segment.documentId,
      text: segment.text,
      translated_text: segment.translatedText,
      correction: segment.correction,
      final_text: segment.finalText,
      status: segment.status,
      type: segment.type,
      parent_id: segment.parentId,
      block_type: segment.blockType,
      position: segment.position,
      format_snapshot: segment.formatSnapshot,
      tm_match_type: segment.tmMatchType,
      tm_score: segment.tmScore,
      row: segment.row,
      col: segment.col,
      table_index: segment.tableIndex,
      row_count: segment.rowCount,
      col_count: segment.colCount,
      col_widths: segment.colWidths,
      created_at: segment.createdAt?.toISOString() ?? null,
      updated_at: segment.updatedAt?.toISOString() ?? null,
      assigned_to_clerk_user_id: assignment?.assignedToClerkUserId ?? null,
      assigned_to_email: assignment?.assignedToEmail ?? null,
      assigned_to_name: assignment?.assignedToName ?? null,
    }
  })
}
