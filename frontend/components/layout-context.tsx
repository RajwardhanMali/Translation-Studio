'use client'

import React, { createContext, useContext, useState, type ReactNode } from 'react'

interface LayoutContextType {
  title: string
  setTitle: (title: string) => void
  subtitle: string
  setSubtitle: (subtitle: string) => void
  actions: ReactNode
  setActions: (actions: ReactNode) => void
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined)

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [actions, setActions] = useState<ReactNode>(null)

  return (
    <LayoutContext.Provider value={{ title, setTitle, subtitle, setSubtitle, actions, setActions }}>
      {children}
    </LayoutContext.Provider>
  )
}

export function useLayout() {
  const context = useContext(LayoutContext)
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider')
  }
  return context
}

export function LayoutHeader({ title, subtitle, actions }: { title?: string; subtitle?: string; actions?: ReactNode }) {
  const { setTitle, setSubtitle, setActions } = useLayout()
  
  React.useEffect(() => {
    if (title !== undefined) setTitle(title)
    if (subtitle !== undefined) setSubtitle(subtitle)
    if (actions !== undefined) setActions(actions)
  }, [title, subtitle, actions, setTitle, setSubtitle, setActions])

  return null
}
