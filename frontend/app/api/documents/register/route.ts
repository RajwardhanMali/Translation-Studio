import { NextRequest, NextResponse } from 'next/server'
import { requireAuthenticatedCollaborator, ensureDocumentOwnerAccess } from '@/lib/document-collaboration'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const documentId = typeof body?.documentId === 'string' ? body.documentId : null

  if (!documentId) {
    return NextResponse.json({ error: 'documentId is required.' }, { status: 400 })
  }

  try {
    const currentUser = await requireAuthenticatedCollaborator()
    const membership = await ensureDocumentOwnerAccess(documentId, currentUser)

    return NextResponse.json({
      documentId,
      role: membership?.role ?? 'owner',
      registered: true,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to register document ownership.',
      },
      { status: 500 },
    )
  }
}
