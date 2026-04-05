'use client'

import React, { useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { LayoutProvider, useLayout } from '@/components/layout-context'

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { title, subtitle, actions } = useLayout()

  return (
    <AppShell title={title} subtitle={subtitle} actions={actions}>
      {children}
    </AppShell>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <LayoutProvider>
      <DashboardShell>{children}</DashboardShell>
    </LayoutProvider>
  )
}
