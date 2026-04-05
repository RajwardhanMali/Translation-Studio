'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@clerk/nextjs'
import { setBackendAuthUserId } from '@/lib/api'

export function AuthSync() {
  const { isLoaded, userId } = useAuth()
  const syncedForUserRef = useRef<string | null>(null)

  useEffect(() => {
    setBackendAuthUserId(userId ?? null)

    if (!isLoaded || !userId) return
    if (syncedForUserRef.current === userId) return

    syncedForUserRef.current = userId

    void fetch('/api/auth/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }).catch(() => {
      syncedForUserRef.current = null
    })
  }, [isLoaded, userId])

  return null
}
