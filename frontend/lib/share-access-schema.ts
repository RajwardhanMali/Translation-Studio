import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const documentShareAccess = pgTable('document_share_access', {
  id: uuid('id').defaultRandom().primaryKey(),
  shareId: text('share_id').notNull(),
  documentId: text('document_id').notNull(),
  ownerClerkUserId: text('owner_clerk_user_id').notNull(),
  recipientClerkUserId: text('recipient_clerk_user_id').notNull(),
  recipientEmail: text('recipient_email').notNull(),
  recipientName: text('recipient_name'),
  accessedAt: timestamp('accessed_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
