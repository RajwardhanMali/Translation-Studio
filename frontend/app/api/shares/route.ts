import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db-index'
import { ensureAppTables } from '@/lib/db-ensure'
import { documentShares } from '@/lib/db/schema'

export async function POST(request: NextRequest) {
  const { userId } = await auth()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const documentId = typeof body?.documentId === 'string' ? body.documentId : null

  if (!documentId) {
    return NextResponse.json({ error: 'documentId is required.' }, { status: 400 })
  }

  await ensureAppTables()

  const db = getDb()

  const existing = await db.query.documentShares.findFirst({
    where: and(
      eq(documentShares.documentId, documentId),
      eq(documentShares.ownerClerkUserId, userId)
    ),
  })

  if (existing) {
    return NextResponse.json({
      shareId: existing.shareId,
      shareUrl: `/share/${existing.shareId}`,
    })
  }

  const shareId = crypto.randomUUID()

  await db.insert(documentShares).values({
    shareId,
    documentId,
    ownerClerkUserId: userId,
    accessMode: 'viewer',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return NextResponse.json({
    shareId,
    shareUrl: `/share/${shareId}`,
  })
}
