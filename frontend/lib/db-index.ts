import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './db/schema'

const globalForDb = globalThis as typeof globalThis & {
  __translationStudioPool?: Pool
}

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set.')
  }

  return connectionString
}

export function getPool() {
  const existingPool = globalForDb.__translationStudioPool

  if (existingPool) {
    return existingPool
  }

  const pool = new Pool({ connectionString: getConnectionString() })

  if (process.env.NODE_ENV !== 'production') {
    globalForDb.__translationStudioPool = pool
  }

  return pool
}

export function getDb() {
  return drizzle(getPool(), { schema })
}
