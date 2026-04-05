import { NextRequest, NextResponse } from 'next/server'
import {
  COLLABORATOR_ROLES,
  findRegisteredUserByEmail,
  getDocumentMembershipOrThrow,
  listCollaborators,
  removeCollaborator,
  upsertCollaborator,
} from '@/lib/document-collaboration'

const ASSIGNABLE_ROLES = COLLABORATOR_ROLES.filter((role) => role !== 'owner')

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params

  try {
    const { membership } = await getDocumentMembershipOrThrow(documentId)
    const collaborators = await listCollaborators(documentId)

    return NextResponse.json({
      documentId,
      currentRole: membership.role,
      collaborators,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === 'FORBIDDEN'
            ? 'You do not have access to this document.'
            : 'Failed to load collaborators.',
      },
      { status: error instanceof Error && error.message === 'FORBIDDEN' ? 403 : 500 },
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const role = typeof body?.role === 'string' ? body.role : ''

  if (!email) {
    return NextResponse.json({ error: 'Collaborator email is required.' }, { status: 400 })
  }

  if (!ASSIGNABLE_ROLES.includes(role as (typeof ASSIGNABLE_ROLES)[number])) {
    return NextResponse.json({ error: 'Invalid collaborator role.' }, { status: 400 })
  }

  try {
    const { currentUser, membership } = await getDocumentMembershipOrThrow(documentId)
    if (membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the document owner can manage collaborators.' }, { status: 403 })
    }

    const targetUser = await findRegisteredUserByEmail(email)
    if (!targetUser) {
      return NextResponse.json(
        { error: 'That user is not registered yet. Ask them to sign in first.' },
        { status: 404 },
      )
    }

    if (targetUser.clerkUserId === currentUser.clerkUserId) {
      return NextResponse.json({ error: 'You already own this document.' }, { status: 400 })
    }

    await upsertCollaborator(
      documentId,
      {
        clerkUserId: targetUser.clerkUserId,
        email: targetUser.email,
        name: targetUser.name,
      },
      role as 'editor' | 'viewer',
      currentUser.clerkUserId,
    )

    return NextResponse.json({
      documentId,
      currentRole: membership.role,
      collaborators: await listCollaborators(documentId),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === 'FORBIDDEN'
            ? 'You do not have access to this document.'
            : 'Failed to add collaborator.',
      },
      { status: error instanceof Error && error.message === 'FORBIDDEN' ? 403 : 500 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params
  const body = await request.json().catch(() => null)
  const collaboratorClerkUserId =
    typeof body?.collaboratorClerkUserId === 'string' ? body.collaboratorClerkUserId : ''

  if (!collaboratorClerkUserId) {
    return NextResponse.json({ error: 'collaboratorClerkUserId is required.' }, { status: 400 })
  }

  try {
    const { membership } = await getDocumentMembershipOrThrow(documentId)
    if (membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the document owner can manage collaborators.' }, { status: 403 })
    }

    await removeCollaborator(documentId, collaboratorClerkUserId)

    return NextResponse.json({
      documentId,
      currentRole: membership.role,
      collaborators: await listCollaborators(documentId),
    })
  } catch (error) {
    const code =
      error instanceof Error && error.message === 'CANNOT_REMOVE_OWNER'
        ? 400
        : error instanceof Error && error.message === 'FORBIDDEN'
          ? 403
          : 500

    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === 'CANNOT_REMOVE_OWNER'
            ? 'The owner cannot be removed from the document.'
            : error instanceof Error && error.message === 'FORBIDDEN'
              ? 'You do not have access to this document.'
              : 'Failed to remove collaborator.',
      },
      { status: code },
    )
  }
}
