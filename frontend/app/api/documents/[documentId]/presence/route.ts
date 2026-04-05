import { NextRequest, NextResponse } from 'next/server'
import {
  clearDocumentPresence,
  getDocumentMembershipOrThrow,
  heartbeatDocumentPresence,
  listActivePresence,
} from '@/lib/document-collaboration'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params

  try {
    const { membership } = await getDocumentMembershipOrThrow(documentId)
    return NextResponse.json({
      documentId,
      currentRole: membership.role,
      activeUsers: await listActivePresence(documentId),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === 'FORBIDDEN'
            ? 'You do not have access to this document.'
            : 'Failed to load presence.',
      },
      { status: error instanceof Error && error.message === 'FORBIDDEN' ? 403 : 500 },
    )
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params

  try {
    const { currentUser, membership } = await getDocumentMembershipOrThrow(documentId)
    await heartbeatDocumentPresence(documentId, {
      clerkUserId: currentUser.clerkUserId,
      email: currentUser.email,
      name: currentUser.name,
      role: membership.role as 'owner' | 'editor' | 'viewer',
    })

    return NextResponse.json({
      documentId,
      currentRole: membership.role,
      activeUsers: await listActivePresence(documentId),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === 'FORBIDDEN'
            ? 'You do not have access to this document.'
            : 'Failed to update presence.',
      },
      { status: error instanceof Error && error.message === 'FORBIDDEN' ? 403 : 500 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params

  try {
    const { currentUser } = await getDocumentMembershipOrThrow(documentId)
    await clearDocumentPresence(documentId, currentUser.clerkUserId)

    return NextResponse.json({ documentId, cleared: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === 'FORBIDDEN'
            ? 'You do not have access to this document.'
            : 'Failed to clear presence.',
      },
      { status: error instanceof Error && error.message === 'FORBIDDEN' ? 403 : 500 },
    )
  }
}
