import useSWR from 'swr'
import { getDocuments, getShareOverview, type DocumentSummary, type ShareOverviewResponse } from '@/lib/api'

export function useDocuments() {
  const { data, error, isLoading, mutate } = useSWR<DocumentSummary[]>('/documents', getDocuments, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: 10000, // 10 seconds deduping
  })

  return {
    documents: data || [],
    isLoading,
    isError: error,
    mutate,
  }
}

export function useShareOverview() {
  const { data, error, isLoading, mutate } = useSWR<ShareOverviewResponse>('/api/shares', getShareOverview, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  })

  return {
    shareOverview: data || {
      ownedByDocument: {},
      visibleByDocument: {},
      receivedDocumentIds: [],
    },
    isLoading,
    isError: error,
    mutate,
  }
}
