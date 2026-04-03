import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db-index'
import { ensureAppTables } from '@/lib/db-ensure'
import { documentShares } from '@/lib/db/schema'
import { documentShareAccess } from '@/lib/share-access-schema'

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

export async function GET() {
  const { userId } = await auth()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await ensureAppTables()

  const db = getDb()

  const ownedShares = await db.query.documentShares.findMany({
    where: eq(documentShares.ownerClerkUserId, userId),
  })

  const ownedShareAccess = await db.query.documentShareAccess.findMany({
    where: eq(documentShareAccess.ownerClerkUserId, userId),
    orderBy: desc(documentShareAccess.updatedAt),
  })

  const receivedShares = await db.query.documentShareAccess.findMany({
    where: eq(documentShareAccess.recipientClerkUserId, userId),
    orderBy: desc(documentShareAccess.updatedAt),
  })

  const ownedByDocument = ownedShares.reduce<Record<string, { shareId: string; shareUrl: string; recipients: Array<{ clerkUserId: string; email: string; name: string | null; accessedAt: string }> }>>(
    (acc, share) => {
      acc[share.documentId] = {
        shareId: share.shareId,
        shareUrl: `/share/${share.shareId}`,
        recipients: ownedShareAccess
          .filter((access) => access.shareId === share.shareId)
          .map((access) => ({
            clerkUserId: access.recipientClerkUserId,
            email: access.recipientEmail,
            name: access.recipientName,
            accessedAt: access.updatedAt.toISOString(),
          })),
      }

      return acc
    },
    {},
  )

  const receivedDocumentIds = Array.from(
    new Set(receivedShares.map((share) => share.documentId)),
  )

  return NextResponse.json({
    ownedByDocument,
    receivedDocumentIds,
  })
}
