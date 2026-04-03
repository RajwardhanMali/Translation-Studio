import { redirect, notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db-index'
import { ensureAppTables } from '@/lib/db-ensure'
import { documentShares } from '@/lib/db/schema'

export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ shareId: string }>
}) {
  const { shareId } = await params
  const { userId } = await auth()

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

  redirect(`/translate?doc=${share.documentId}`)
}
