import { pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core'

export const documents = pgTable('documents', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  filename: text('filename'),
  fileType: text('file_type'),
  createdAt: timestamp('created_at', { withTimezone: true }),
})

export const appUsers = pgTable('app_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const documentShares = pgTable('document_shares', {
  id: uuid('id').defaultRandom().primaryKey(),
  shareId: text('share_id').notNull().unique(),
  documentId: text('document_id').notNull(),
  ownerClerkUserId: text('owner_clerk_user_id').notNull(),
  accessMode: text('access_mode').default('viewer').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const documentCollaborators = pgTable(
  'document_collaborators',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: text('document_id').notNull(),
    collaboratorClerkUserId: text('collaborator_clerk_user_id').notNull(),
    collaboratorEmail: text('collaborator_email').notNull(),
    collaboratorName: text('collaborator_name'),
    role: text('role').notNull().default('viewer'),
    addedByClerkUserId: text('added_by_clerk_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    documentCollaboratorUnique: uniqueIndex('document_collaborators_doc_user_uidx').on(
      table.documentId,
      table.collaboratorClerkUserId,
    ),
  }),
)

export const documentPresence = pgTable(
  'document_presence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: text('document_id').notNull(),
    collaboratorClerkUserId: text('collaborator_clerk_user_id').notNull(),
    collaboratorEmail: text('collaborator_email').notNull(),
    collaboratorName: text('collaborator_name'),
    role: text('role').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    documentPresenceUnique: uniqueIndex('document_presence_doc_user_uidx').on(
      table.documentId,
      table.collaboratorClerkUserId,
    ),
  }),
)
