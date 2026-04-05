import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { ensureAppTables } from '@/lib/db-ensure'
import { getDb } from '@/lib/db-index'
import { appUsers, documentCollaborators, segmentAssignments, segments } from '@/lib/db/schema'
import { getDocumentMembershipOrThrow } from '@/lib/document-collaboration'

type AssignRequest = {
  document_id?: string
  segment_ids?: string[]
  assignee_clerk_user_id?: string
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as AssignRequest | null
  const documentId = body?.document_id
  const segmentIds = Array.from(new Set(body?.segment_ids ?? []))
  const assigneeClerkUserId = body?.assignee_clerk_user_id

  if (!documentId || !segmentIds.length || !assigneeClerkUserId) {
    return NextResponse.json(
      { error: 'document_id, segment_ids and assignee_clerk_user_id are required.' },
      { status: 400 },
    )
  }

  try {
    const { currentUser, membership } = await getDocumentMembershipOrThrow(documentId)
    if (membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only owners can assign segments.' }, { status: 403 })
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

    const assigneeMembership = await db.query.documentCollaborators.findFirst({
      where: and(
        eq(documentCollaborators.documentId, documentId),
        eq(documentCollaborators.collaboratorClerkUserId, assigneeClerkUserId),
      ),
    })

    if (!assigneeMembership) {
      return NextResponse.json({ error: 'Assignee is not a document collaborator.' }, { status: 404 })
    }

    if (assigneeMembership.role !== 'editor') {
      return NextResponse.json({ error: 'Segments can only be assigned to editors.' }, { status: 400 })
    }

    const assigneeUser = await db.query.appUsers.findFirst({
      where: eq(appUsers.clerkUserId, assigneeClerkUserId),
    })

    if (!assigneeUser) {
      return NextResponse.json({ error: 'Assignee is not registered.' }, { status: 404 })
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
        error: forbidden ? 'You do not have access to this document.' : 'Failed to assign segments.',
      },
      { status: forbidden ? 403 : 500 },
    )
  }
}
