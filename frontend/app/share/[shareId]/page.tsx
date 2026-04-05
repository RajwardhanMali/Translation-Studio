import { redirect, notFound } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db-index'
import { ensureAppTables } from '@/lib/db-ensure'
import { documentShares } from '@/lib/db/schema'
import { documentShareAccess } from '@/lib/share-access-schema'
import { ensureSharedDocumentCollaborator } from '@/lib/document-collaboration'

export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ shareId: string }>
}) {
  const { shareId } = await params
  const { userId } = await auth()
  const user = await currentUser()

  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/share/${shareId}`)}`)
  }

  await ensureAppTables()

  const db = getDb()

  const share = await db.query.documentShares.findFirst({
    where: eq(documentShares.shareId, shareId),
  })

  if (!share) {
    notFound()
  }

  if (share.ownerClerkUserId !== userId && user) {
    const primaryEmail =
      user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)
        ?.emailAddress ?? 'unknown@example.com'
    const recipientName =
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.username ||
      null

    const existingAccess = await db.query.documentShareAccess.findFirst({
      where: and(
        eq(documentShareAccess.shareId, shareId),
        eq(documentShareAccess.recipientClerkUserId, userId),
      ),
    })

    if (!existingAccess) {
      await db.insert(documentShareAccess).values({
        shareId,
        documentId: share.documentId,
        ownerClerkUserId: share.ownerClerkUserId,
        recipientClerkUserId: userId,
        recipientEmail: primaryEmail,
        recipientName,
        accessedAt: new Date(),
        updatedAt: new Date(),
      })
    }

    await ensureSharedDocumentCollaborator(
      share.documentId,
      {
        clerkUserId: userId,
        email: primaryEmail,
        name: recipientName,
      },
      share.accessMode === 'editor' ? 'editor' : 'viewer',
      share.ownerClerkUserId,
    )
  }

  redirect(`/translate?doc=${share.documentId}`)
}
