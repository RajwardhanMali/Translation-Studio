import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { listVisibleDocumentsForUser } from '@/lib/document-read'

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const documents = await listVisibleDocumentsForUser(userId)
    return NextResponse.json(documents)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load documents.',
      },
      { status: 500 },
    )
  }
}
