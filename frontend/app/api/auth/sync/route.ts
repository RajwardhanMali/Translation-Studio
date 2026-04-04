import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { syncAuthenticatedUser } from '@/lib/auth-sync'

export async function POST() {
  const { userId } = await auth()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const user = await syncAuthenticatedUser()
    return NextResponse.json({ synced: true, user })
  } catch (error) {
    return NextResponse.json(
      {
        synced: false,
        error: error instanceof Error ? error.message : 'Failed to sync user.',
      },
      { status: 500 }
    )
  }
}
