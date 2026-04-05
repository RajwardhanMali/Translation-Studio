import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { ensureAppTables } from '@/lib/db-ensure'
import { getDb } from '@/lib/db-index'
import { appUsers, segmentAssignments, segments } from '@/lib/db/schema'
import { getDocumentMembershipOrThrow } from '@/lib/document-collaboration'

type ClaimRequest = {
  document_id?: string
  segment_ids?: string[]
  assignee_clerk_user_id?: string
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ClaimRequest | null
  const documentId = body?.document_id
  const segmentIds = Array.from(new Set(body?.segment_ids ?? []))

  if (!documentId || !segmentIds.length) {
    return NextResponse.json(
      { error: 'document_id and segment_ids are required.' },
      { status: 400 },
    )
  }

  try {
    const { currentUser, membership } = await getDocumentMembershipOrThrow(documentId)
    if (!['owner', 'editor'].includes(membership.role)) {
      return NextResponse.json({ error: 'Only owners and editors can claim segments.' }, { status: 403 })
    }

    await ensureAppTables()
    const db = getDb()

    const docSegments = await db.query.segments.findMany({
      where: and(
        eq(segments.documentId, documentId),
        inArray(segments.id, segmentIds),
      ),
    })

    if (docSegments.length !== segmentIds.length) {
      return NextResponse.json(
        { error: 'One or more segments do not belong to this document.' },
        { status: 400 },
      )
    }

    const assigneeUser = await db.query.appUsers.findFirst({
      where: eq(appUsers.clerkUserId, currentUser.clerkUserId),
    })

    if (!assigneeUser) {
      return NextResponse.json({ error: 'Authenticated user is not registered.' }, { status: 401 })
    }

    const existingAssignments = await db.query.segmentAssignments.findMany({
      where: and(
        eq(segmentAssignments.documentId, documentId),
        inArray(segmentAssignments.segmentId, segmentIds),
      ),
    })
    const assignmentBySegmentId = new Map(existingAssignments.map((a) => [a.segmentId, a]))

    const now = new Date()
    const responseAssignments = [] as Array<{
      segment_id: string
      document_id: string
      assigned_to_clerk_user_id: string
      assigned_to_email: string
      assigned_to_name: string | null
      assigned_by_clerk_user_id: string
      updated_at: string
    }>

    for (const segmentId of segmentIds) {
      const existing = assignmentBySegmentId.get(segmentId)

      if (existing) {
        await db
          .update(segmentAssignments)
          .set({
            assignedToClerkUserId: assigneeUser.clerkUserId,
            assignedToEmail: assigneeUser.email,
            assignedToName: assigneeUser.name,
            assignedByClerkUserId: currentUser.clerkUserId,
            updatedAt: now,
          })
          .where(eq(segmentAssignments.id, existing.id))
      } else {
        await db.insert(segmentAssignments).values({
          segmentId,
          documentId,
          assignedToClerkUserId: assigneeUser.clerkUserId,
          assignedToEmail: assigneeUser.email,
          assignedToName: assigneeUser.name,
          assignedByClerkUserId: currentUser.clerkUserId,
          createdAt: now,
          updatedAt: now,
        })
      }

      responseAssignments.push({
        segment_id: segmentId,
        document_id: documentId,
        assigned_to_clerk_user_id: assigneeUser.clerkUserId,
        assigned_to_email: assigneeUser.email,
        assigned_to_name: assigneeUser.name,
        assigned_by_clerk_user_id: currentUser.clerkUserId,
        updated_at: now.toISOString(),
      })
    }

    return NextResponse.json({
      document_id: documentId,
      assignments: responseAssignments,
    })
  } catch (error) {
    const forbidden = error instanceof Error && error.message === 'FORBIDDEN'
    return NextResponse.json(
      {
        error: forbidden ? 'You do not have access to this document.' : 'Failed to claim segments.',
      },
      { status: forbidden ? 403 : 500 },
    )
  }
}
