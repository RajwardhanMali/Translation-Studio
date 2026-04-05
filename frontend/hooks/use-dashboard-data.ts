import { useEffect, useCallback } from 'react'
import { useDashboardStore } from '@/store/use-dashboard-store'

export function useDocuments() {
  const { 
    documents, 
    isLoadingDocs, 
    errorDocs, 
    fetchDocuments 
  } = useDashboardStore()

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  const mutate = useCallback(async () => {
    await fetchDocuments(true)
  }, [fetchDocuments])

  return {
    documents,
    isLoading: isLoadingDocs,
    isError: errorDocs,
    mutate,
  }
}

export function useShareOverview() {
  const { 
    shareOverview, 
    isLoadingShares, 
    errorShares, 
    fetchShareOverview 
  } = useDashboardStore()

  useEffect(() => {
    fetchShareOverview()
  }, [fetchShareOverview])

  const mutate = useCallback(async () => {
    await fetchShareOverview(true)
  }, [fetchShareOverview])

  return {
    shareOverview,
    isLoading: isLoadingShares,
    isError: errorShares,
    mutate,
  }
}
