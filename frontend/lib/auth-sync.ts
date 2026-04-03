import { currentUser } from '@clerk/nextjs/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db-index'
import { ensureAppTables } from '@/lib/db-ensure'
import { appUsers } from '@/lib/db/schema'

export async function syncAuthenticatedUser() {
  const user = await currentUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  await ensureAppTables()

  const db = getDb()

  const primaryEmail = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress

  if (!primaryEmail) {
    throw new Error('Authenticated user has no primary email.')
  }

  const payload = {
    clerkUserId: user.id,
    email: primaryEmail,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || null,
    avatarUrl: user.imageUrl || null,
    updatedAt: new Date(),
  }

  const existing = await db.query.appUsers.findFirst({
    where: eq(appUsers.clerkUserId, user.id),
  })

  if (!existing) {
    await db.insert(appUsers).values({
      ...payload,
      createdAt: new Date(),
    })
  } else {
    await db
      .update(appUsers)
      .set(payload)
      .where(eq(appUsers.clerkUserId, user.id))
  }

  return payload
}
