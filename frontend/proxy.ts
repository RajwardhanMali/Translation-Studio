import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher([
  '/documents(.*)',
  '/upload(.*)',
  '/validate(.*)',
  '/translate(.*)',
  '/glossary(.*)',
  '/share(.*)',
  '/api/auth/sync(.*)',
  '/api/collaboration(.*)',
  '/api/documents(.*)',
  '/api/dashboard(.*)',
  '/api/review(.*)',
  '/api/shares(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
