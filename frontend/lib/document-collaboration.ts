import { and, eq, gt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db-index'
import { ensureAppTables } from '@/lib/db-ensure'
import { syncAuthenticatedUser } from '@/lib/auth-sync'
import { appUsers, documentCollaborators, documentPresence, documents } from '@/lib/db/schema'

export const COLLABORATOR_ROLES = ['owner', 'editor', 'viewer'] as const
export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number]

export interface AuthenticatedCollaborator {
  clerkUserId: string
  email: string
  name: string | null
}

async function getDocumentOwnerClerkUserId(documentId: string) {
  await ensureAppTables()
  const db = getDb()

  const match = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  })

  return match?.userId ?? null
}

export async function requireAuthenticatedCollaborator() {
  const synced = await syncAuthenticatedUser()
  return {
    clerkUserId: synced.clerkUserId,
    email: synced.email,
    name: synced.name,
  } satisfies AuthenticatedCollaborator
}

export async function ensureDocumentOwnerAccess(
  documentId: string,
  currentUser: AuthenticatedCollaborator,
) {
  await ensureAppTables()
  const db = getDb()
  const ownerClerkUserId = await getDocumentOwnerClerkUserId(documentId)

  const collaborators = await db.query.documentCollaborators.findMany({
    where: eq(documentCollaborators.documentId, documentId),
  })

  const existingMembership = collaborators.find(
    (collaborator) =>
      collaborator.collaboratorClerkUserId === currentUser.clerkUserId,
  )

  const shouldBeOwner =
    ownerClerkUserId === currentUser.clerkUserId ||
    (!ownerClerkUserId && collaborators.length === 0)

  if (shouldBeOwner) {
    const now = new Date()
    if (existingMembership) {
      if (
        existingMembership.role !== 'owner' ||
        existingMembership.collaboratorEmail !== currentUser.email ||
        existingMembership.collaboratorName !== currentUser.name
      ) {
        await db
          .update(documentCollaborators)
          .set({
            collaboratorEmail: currentUser.email,
            collaboratorName: currentUser.name,
            role: 'owner',
            addedByClerkUserId: currentUser.clerkUserId,
            updatedAt: now,
          })
          .where(eq(documentCollaborators.id, existingMembership.id))
      }

      return {
        ...existingMembership,
        collaboratorEmail: currentUser.email,
        collaboratorName: currentUser.name,
        role: 'owner' as const,
        addedByClerkUserId: currentUser.clerkUserId,
        updatedAt: now,
      }
    }

    await db.insert(documentCollaborators).values({
      documentId,
      collaboratorClerkUserId: currentUser.clerkUserId,
      collaboratorEmail: currentUser.email,
      collaboratorName: currentUser.name,
      role: 'owner',
      addedByClerkUserId: currentUser.clerkUserId,
      createdAt: now,
      updatedAt: now,
    })

    return {
      documentId,
      collaboratorClerkUserId: currentUser.clerkUserId,
      collaboratorEmail: currentUser.email,
      collaboratorName: currentUser.name,
      role: 'owner' as const,
      addedByClerkUserId: currentUser.clerkUserId,
      createdAt: now,
      updatedAt: now,
    }
  }

  if (!existingMembership) {
    return null
  }

  return existingMembership
}

export async function getDocumentMembershipOrThrow(documentId: string) {
  const currentUser = await requireAuthenticatedCollaborator()
  const membership = await ensureDocumentOwnerAccess(documentId, currentUser)

  if (!membership) {
    throw new Error('FORBIDDEN')
  }

  return { currentUser, membership }
}

export async function findRegisteredUserByEmail(email: string) {
  await ensureAppTables()
  const db = getDb()
  const normalizedEmail = email.trim().toLowerCase()

  const matches = await db
    .select()
    .from(appUsers)
    .where(sql`lower(${appUsers.email}) = ${normalizedEmail}`)
    .limit(1)

  return matches[0] ?? null
}

export async function listCollaborators(documentId: string) {
  await ensureAppTables()
  const db = getDb()
  const collaborators = await db.query.documentCollaborators.findMany({
    where: eq(documentCollaborators.documentId, documentId),
  })

  return [...collaborators].sort((left, right) => {
    const leftRank = left.role === 'owner' ? 0 : left.role === 'editor' ? 1 : 2
    const rightRank = right.role === 'owner' ? 0 : right.role === 'editor' ? 1 : 2
    if (leftRank !== rightRank) return leftRank - rightRank
    return left.collaboratorEmail.localeCompare(right.collaboratorEmail)
  })
}

export async function upsertCollaborator(
  documentId: string,
  targetUser: {
    clerkUserId: string
    email: string
    name: string | null
  },
  role: Exclude<CollaboratorRole, 'owner'>,
  addedByClerkUserId: string,
) {
  await ensureAppTables()
  const db = getDb()

  const existing = await db.query.documentCollaborators.findFirst({
    where: and(
      eq(documentCollaborators.documentId, documentId),
      eq(
        documentCollaborators.collaboratorClerkUserId,
        targetUser.clerkUserId,
      ),
    ),
  })

  const now = new Date()
  if (existing) {
    await db
      .update(documentCollaborators)
      .set({
        collaboratorEmail: targetUser.email,
        collaboratorName: targetUser.name,
        role,
        addedByClerkUserId,
        updatedAt: now,
      })
      .where(eq(documentCollaborators.id, existing.id))
  } else {
    await db.insert(documentCollaborators).values({
      documentId,
      collaboratorClerkUserId: targetUser.clerkUserId,
      collaboratorEmail: targetUser.email,
      collaboratorName: targetUser.name,
      role,
      addedByClerkUserId,
      createdAt: now,
      updatedAt: now,
    })
  }
}

export async function ensureSharedDocumentCollaborator(
  documentId: string,
  targetUser: {
    clerkUserId: string
    email: string
    name: string | null
  },
  role: Exclude<CollaboratorRole, 'owner'>,
  addedByClerkUserId: string,
) {
  await ensureAppTables()
  const db = getDb()
  const ownerClerkUserId = await getDocumentOwnerClerkUserId(documentId)

  if (ownerClerkUserId === targetUser.clerkUserId) {
    return ensureDocumentOwnerAccess(documentId, targetUser)
  }

  const existing = await db.query.documentCollaborators.findFirst({
    where: and(
      eq(documentCollaborators.documentId, documentId),
      eq(
        documentCollaborators.collaboratorClerkUserId,
        targetUser.clerkUserId,
      ),
    ),
  })

  if (existing) {
    if (
      existing.collaboratorEmail !== targetUser.email ||
      existing.collaboratorName !== targetUser.name
    ) {
      await db
        .update(documentCollaborators)
        .set({
          collaboratorEmail: targetUser.email,
          collaboratorName: targetUser.name,
          updatedAt: new Date(),
        })
        .where(eq(documentCollaborators.id, existing.id))
    }
    return existing
  }

  await upsertCollaborator(documentId, targetUser, role, addedByClerkUserId)
  return db.query.documentCollaborators.findFirst({
    where: and(
      eq(documentCollaborators.documentId, documentId),
      eq(
        documentCollaborators.collaboratorClerkUserId,
        targetUser.clerkUserId,
      ),
    ),
  })
}

export async function removeCollaborator(
  documentId: string,
  collaboratorClerkUserId: string,
) {
  await ensureAppTables()
  const db = getDb()

  const existing = await db.query.documentCollaborators.findFirst({
    where: and(
      eq(documentCollaborators.documentId, documentId),
      eq(
        documentCollaborators.collaboratorClerkUserId,
        collaboratorClerkUserId,
      ),
    ),
  })

  if (!existing) {
    return false
  }

  if (existing.role === 'owner') {
    throw new Error('CANNOT_REMOVE_OWNER')
  }

  await db
    .delete(documentCollaborators)
    .where(eq(documentCollaborators.id, existing.id))

  return true
}

export async function heartbeatDocumentPresence(
  documentId: string,
  collaborator: {
    clerkUserId: string
    email: string
    name: string | null
    role: CollaboratorRole
  },
) {
  await ensureAppTables()
  const db = getDb()

  const existing = await db.query.documentPresence.findFirst({
    where: and(
      eq(documentPresence.documentId, documentId),
      eq(documentPresence.collaboratorClerkUserId, collaborator.clerkUserId),
    ),
  })

  const now = new Date()
  if (existing) {
    await db
      .update(documentPresence)
      .set({
        collaboratorEmail: collaborator.email,
        collaboratorName: collaborator.name,
        role: collaborator.role,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(documentPresence.id, existing.id))
  } else {
    await db.insert(documentPresence).values({
      documentId,
      collaboratorClerkUserId: collaborator.clerkUserId,
      collaboratorEmail: collaborator.email,
      collaboratorName: collaborator.name,
      role: collaborator.role,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
  }
}

export async function clearDocumentPresence(
  documentId: string,
  collaboratorClerkUserId: string,
) {
  await ensureAppTables()
  const db = getDb()

  const existing = await db.query.documentPresence.findFirst({
    where: and(
      eq(documentPresence.documentId, documentId),
      eq(documentPresence.collaboratorClerkUserId, collaboratorClerkUserId),
    ),
  })

  if (!existing) return

  await db.delete(documentPresence).where(eq(documentPresence.id, existing.id))
}

export async function listActivePresence(documentId: string) {
  await ensureAppTables()
  const db = getDb()
  const cutoff = new Date(Date.now() - 2 * 60 * 1000)

  const active = await db.query.documentPresence.findMany({
    where: and(
      eq(documentPresence.documentId, documentId),
      gt(documentPresence.lastSeenAt, cutoff),
    ),
  })

  return [...active].sort((left, right) => {
    if (left.role === 'owner' && right.role !== 'owner') return -1
    if (left.role !== 'owner' && right.role === 'owner') return 1
    return left.collaboratorEmail.localeCompare(right.collaboratorEmail)
  })
}
