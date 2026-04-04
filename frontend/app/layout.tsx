import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Analytics } from '@vercel/analytics/next'
import { MotionProvider } from '@/components/motion/primitives'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toaster'
import './globals.css'

export const metadata: Metadata = {
  title: 'SynTra AI',
  description: 'Premium ai translation workspace for validation, multilingual review, glossary control, and export.',
  generator: 'Codex',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body
          className="font-sans antialiased"
          cz-shortcut-listen="true"
        >
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <MotionProvider>
              {children}
              <Toaster />
              <Analytics />
            </MotionProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
