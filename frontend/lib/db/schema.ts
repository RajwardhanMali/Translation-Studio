import { json, pgTable, text, timestamp, uuid, uniqueIndex, integer, real } from 'drizzle-orm/pg-core'

export const documents = pgTable('documents', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  filename: text('filename'),
  fileType: text('file_type'),
  firebaseUrl: text('firebase_url'),
  status: text('status'),
  blocks: json('blocks').$type<unknown[] | null>(),
  metadataJson: json('metadata_json').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }),
})

export const segments = pgTable('segments', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  userId: text('user_id'),
  text: text('text').notNull(),
  translatedText: text('translated_text'),
  correction: text('correction'),
  finalText: text('final_text'),
  type: text('type'),
  status: text('status'),
  parentId: text('parent_id'),
  blockType: text('block_type'),
  position: json('position').$type<Record<string, unknown> | null>(),
  formatSnapshot: json('format_snapshot').$type<Record<string, unknown> | null>(),
  tmMatchType: text('tm_match_type'),
  tmScore: real('tm_score'),
  row: integer('row'),
  col: integer('col'),
  tableIndex: integer('table_index'),
  rowCount: integer('row_count'),
  colCount: integer('col_count'),
  colWidths: json('col_widths').$type<unknown | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export const segmentAssignments = pgTable('segment_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  segmentId: text('segment_id').notNull(),
  documentId: text('document_id').notNull(),
  assignedToClerkUserId: text('assigned_to_clerk_user_id').notNull(),
  assignedToEmail: text('assigned_to_email').notNull(),
  assignedToName: text('assigned_to_name'),
  assignedByClerkUserId: text('assigned_by_clerk_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
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
