import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db-index'
import { ensureAppTables } from '@/lib/db-ensure'
import { appUsers, documentShares } from '@/lib/db/schema'
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

  const allVisibleShares = [
    ...ownedShares,
    ...ownedShares
      .flatMap((share) =>
        receivedShares
          .filter((access) => access.shareId === share.shareId)
          .map(() => share),
      ),
  ]

  const receivedShareIds = Array.from(new Set(receivedShares.map((share) => share.shareId)))
  const missingReceivedShares = receivedShareIds.filter(
    (shareId) => !ownedShares.some((share) => share.shareId === shareId),
  )

  if (missingReceivedShares.length > 0) {
    const additionalShares = await db.query.documentShares.findMany({
      where: inArray(documentShares.shareId, missingReceivedShares),
    })
    allVisibleShares.push(...additionalShares)
  }

  const uniqueVisibleShares = Array.from(
    new Map(allVisibleShares.map((share) => [share.shareId, share])).values(),
  )

  const visibleOwnerIds = Array.from(
    new Set(uniqueVisibleShares.map((share) => share.ownerClerkUserId)),
  )

  const ownerProfiles =
    visibleOwnerIds.length > 0
      ? await db.query.appUsers.findMany({
          where: inArray(appUsers.clerkUserId, visibleOwnerIds),
        })
      : []

  const ownerProfileMap = new Map(
    ownerProfiles.map((profile) => [profile.clerkUserId, profile]),
  )

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

  const visibleByDocument = uniqueVisibleShares.reduce<
    Record<
      string,
      {
        shareId: string
        shareUrl: string
        participants: Array<{
          clerkUserId: string
          email: string
          name: string | null
          accessedAt: string
          role: 'owner' | 'recipient'
        }>
      }
    >
  >((acc, share) => {
    const ownerProfile = ownerProfileMap.get(share.ownerClerkUserId)
    const recipientParticipants = ownedShareAccess
      .concat(receivedShares)
      .filter((access) => access.shareId === share.shareId)
      .map((access) => ({
        clerkUserId: access.recipientClerkUserId,
        email: access.recipientEmail,
        name: access.recipientName,
        accessedAt: access.updatedAt.toISOString(),
        role: 'recipient' as const,
      }))

    const ownerParticipant = {
      clerkUserId: share.ownerClerkUserId,
      email: ownerProfile?.email ?? '',
      name:
        share.ownerClerkUserId === userId
          ? ownerProfile?.name ?? 'You'
          : ownerProfile?.name ?? 'Owner',
      accessedAt: share.updatedAt.toISOString(),
      role: 'owner' as const,
    }

    const participants = Array.from(
      new Map(
        [ownerParticipant, ...recipientParticipants].map((participant) => [
          participant.clerkUserId,
          participant,
        ]),
      ).values(),
    )

    acc[share.documentId] = {
      shareId: share.shareId,
      shareUrl: `/share/${share.shareId}`,
      participants,
    }

    return acc
  }, {})

  return NextResponse.json({
    ownedByDocument,
    visibleByDocument,
    receivedDocumentIds,
  })
}
