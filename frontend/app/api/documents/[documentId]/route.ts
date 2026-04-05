import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getDocumentForUser } from '@/lib/document-read'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { documentId } = await params

  try {
    const document = await getDocumentForUser(documentId, userId)
    if (!document) {
      return NextResponse.json({ error: 'Document not found or inaccessible.' }, { status: 404 })
    }

    return NextResponse.json(document)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load document.',
      },
      { status: 500 },
    )
  }
}
