'use client'

import { useEffect, useState } from 'react'
import { Palette } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div
        className={cn(
          'h-10 w-10 rounded-2xl border border-border/70 bg-background/80 shadow-sm',
          className
        )}
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(
            'h-10 w-10 rounded-2xl border-border/70 bg-background/75 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/60',
            className
          )}
          title="Change theme"
        >
          <Palette className="h-4.5 w-4.5" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-xl border-border/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('rose')}>Rose</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('blue')}>Ocean</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('green')}>Emerald</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('amber')}>Amber</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('purple')}>Amethyst</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
