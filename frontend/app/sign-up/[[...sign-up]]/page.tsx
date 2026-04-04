import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(circle_at_top,rgba(21,196,255,0.16),transparent_42%),radial-gradient(circle_at_15%_15%,rgba(33,238,196,0.12),transparent_32%)]" />
      <SignUp
        fallbackRedirectUrl="/documents"
        appearance={{
          elements: {
            card: 'rounded-[2rem] border border-white/35 bg-white/75 shadow-[0_35px_120px_-50px_rgba(16,24,40,0.55)] backdrop-blur',
            headerTitle: 'text-2xl font-semibold text-foreground',
            headerSubtitle: 'text-sm text-muted-foreground',
            socialButtonsBlockButton:
              'rounded-2xl border border-border/70 bg-background/80 text-foreground hover:bg-accent/40',
            formButtonPrimary: 'rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90',
            footerActionLink: 'text-primary hover:text-primary/80',
          },
        }}
      />
    </main>
  )
}
