import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db-index'

let ensured = false

export async function ensureAppTables() {
  if (ensured) return

  const db = getDb()

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clerk_user_id text NOT NULL UNIQUE,
      email text NOT NULL,
      name text,
      avatar_url text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS document_shares (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      share_id text NOT NULL UNIQUE,
      document_id text NOT NULL,
      owner_clerk_user_id text NOT NULL,
      access_mode text NOT NULL DEFAULT 'viewer',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS document_collaborators (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id text NOT NULL,
      collaborator_clerk_user_id text NOT NULL,
      collaborator_email text NOT NULL,
      collaborator_name text,
      role text NOT NULL DEFAULT 'viewer',
      added_by_clerk_user_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS document_collaborators_doc_user_uidx
    ON document_collaborators (document_id, collaborator_clerk_user_id)
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS document_presence (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id text NOT NULL,
      collaborator_clerk_user_id text NOT NULL,
      collaborator_email text NOT NULL,
      collaborator_name text,
      role text NOT NULL,
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS document_presence_doc_user_uidx
    ON document_presence (document_id, collaborator_clerk_user_id)
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS document_share_access (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      share_id text NOT NULL,
      document_id text NOT NULL,
      owner_clerk_user_id text NOT NULL,
      recipient_clerk_user_id text NOT NULL,
      recipient_email text NOT NULL,
      recipient_name text,
      accessed_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  ensured = true
}
