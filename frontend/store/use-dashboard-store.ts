import { create } from 'zustand'
import { getDocuments, getShareOverview, type DocumentSummary, type ShareOverviewResponse } from '@/lib/api'

interface DashboardState {
  documents: DocumentSummary[]
  shareOverview: ShareOverviewResponse
  isLoadingDocs: boolean
  isLoadingShares: boolean
  errorDocs: any
  errorShares: any
  
  // Cache tracking to prevent duplicate calls
  lastFetchedDocs: number
  lastFetchedShares: number

  fetchDocuments: (force?: boolean) => Promise<void>
  fetchShareOverview: (force?: boolean) => Promise<void>
  refreshAll: () => Promise<void>
  clearStore: () => void
}

const INITIAL_SHARE_OVERVIEW: ShareOverviewResponse = {
  ownedByDocument: {},
  visibleByDocument: {},
  receivedDocumentIds: [],
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  documents: [],
  shareOverview: INITIAL_SHARE_OVERVIEW,
  isLoadingDocs: false,
  isLoadingShares: false,
  errorDocs: null,
  errorShares: null,
  lastFetchedDocs: 0,
  lastFetchedShares: 0,

  fetchDocuments: async (force = false) => {
    const { isLoadingDocs, documents } = get()
    
    // Only fetch if forced or if we don't have any data yet
    if (isLoadingDocs) return
    if (!force && documents.length > 0) return

    set({ isLoadingDocs: true, errorDocs: null })
    try {
      const data = await getDocuments()
      set({ documents: data, lastFetchedDocs: Date.now(), errorDocs: null })
    } catch (error) {
      console.error('Error fetching documents in store:', error)
      set({ errorDocs: error })
    } finally {
      set({ isLoadingDocs: false })
    }
  },

  fetchShareOverview: async (force = false) => {
    const { isLoadingShares, shareOverview } = get()

    // Only fetch if forced or if we don't have any data yet
    if (isLoadingShares) return
    if (!force && shareOverview.receivedDocumentIds.length > 0) return

    set({ isLoadingShares: true, errorShares: null })
    try {
      const data = await getShareOverview()
      set({ shareOverview: data, lastFetchedShares: Date.now(), errorShares: null })
    } catch (error) {
      console.error('Error fetching share overview in store:', error)
      set({ errorShares: error })
    } finally {
      set({ isLoadingShares: false })
    }
  },

  refreshAll: async () => {
    await Promise.all([
      get().fetchDocuments(true),
      get().fetchShareOverview(true)
    ])
  },

  clearStore: () => {
    set({
      documents: [],
      shareOverview: INITIAL_SHARE_OVERVIEW,
      lastFetchedDocs: 0,
      lastFetchedShares: 0,
      errorDocs: null,
      errorShares: null
    })
  }
}))
