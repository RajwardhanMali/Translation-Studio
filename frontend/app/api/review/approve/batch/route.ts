import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

type ApprovalItem = {
  segment_id: string
  correction?: string
}

type BatchApproveRequest = {
  approvals?: ApprovalItem[]
}

function getBackendBaseUrl() {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  return raw.replace(/\/+$/, '')
}

async function approveViaBackend(userId: string, item: ApprovalItem) {
  const response = await fetch(`${getBackendBaseUrl()}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Clerk-User-Id': userId,
    },
    body: JSON.stringify({
      segment_id: item.segment_id,
      approved: true,
      correction: item.correction,
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(payload?.detail || `Approval failed for ${item.segment_id}`)
  }

  return response.json()
}

export async function POST(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as BatchApproveRequest | null
  const approvals = (body?.approvals ?? []).filter(
    (item): item is ApprovalItem => Boolean(item?.segment_id),
  )

  if (!approvals.length) {
    return NextResponse.json({ error: 'approvals is required.' }, { status: 400 })
  }

  const results = await Promise.allSettled(
    approvals.map((item) => approveViaBackend(userId, item)),
  )

  const succeeded: Array<{ segment_id: string; status: string; final_text: string }> = []
  const failed: Array<{ segment_id: string; error: string }> = []

  results.forEach((result, index) => {
    const item = approvals[index]
    if (result.status === 'fulfilled') {
      succeeded.push(result.value)
      return
    }

    failed.push({
      segment_id: item.segment_id,
      error: result.reason instanceof Error ? result.reason.message : 'Approval failed.',
    })
  })

  return NextResponse.json({
    succeeded,
    failed,
  })
}
