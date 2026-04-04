# Award-Winning Frontend For Syntra AI : Translation Studio

You are building a market-ready frontend for an existing product called **Syntra AI : Translation Studio**.

This is not a backend exercise. The backend already exists and exposes the translation workflow APIs listed below. Your job is to create a **beautiful, premium, production-caliber frontend** that feels like a polished SaaS product people would immediately trust and enjoy using.

Build this in a **modular, maintainable way** so the codebase is easy to extend.

Use the existing app direction, but upgrade the experience significantly.

## Product Intent

Syntra AI : Translation Studio helps teams upload documents, validate source content, translate segments, review edits, manage terminology, and export final files.

The frontend should make this workflow feel:

- elegant
- calm
- premium
- fast
- collaborative
- clear even for first-time users

The UI should feel closer to a modern, high-end SaaS onboarding/product experience, not an internal tool or basic dashboard.

## Primary Outcome

Create an **award-worthy frontend** with:

1. a public landing page that sells the product beautifully
2. a premium onboarding/authentication flow
3. authenticated product routes
4. responsive workspace screens for upload, documents, validation, translation, glossary, and export
5. collaboration via shareable links for a document
6. Clerk authentication with Google sign-in
7. Drizzle ORM with Postgres for app-side persistence
8. user sync into Postgres immediately after sign-in/sign-up without relying on Clerk webhooks

## Tech Requirements

Use:

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui where useful
- Clerk authentication
- Google sign-in via Clerk
- Drizzle ORM
- Postgres using `DATABASE_URL` from env

Assume env values will be provided for:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `DATABASE_URL`

## Critical Product Rules

- The **landing page must be public**.
- All other app routes must require login.
- If a user opens a shared translation link while signed out, they must first sign in, then be redirected back to the intended shared destination.
- Backend translation APIs already exist. Build around them, do not invent missing backend behavior.
- Frontend should include all existing backend endpoints in the app flow where relevant.
- Focus strongly on frontend quality, visual hierarchy, delight, and polish.
- The UI must be excellent on mobile, tablet, laptop, and wide desktop screens.

## Design Direction

Create a visual system that feels premium and memorable.

### Design goals

- strong first impression
- beautiful typography
- attractive color palette
- polished spacing and rhythm
- rich but tasteful gradients
- layered surfaces and depth
- subtle motion
- onboarding feel similar to real modern SaaS products
- clear conversion path from landing page to sign-up to product

### Avoid

- generic AI-looking layouts
- plain white-and-purple defaults
- boring hero sections
- flat dashboard-only styling
- cramped enterprise tables without hierarchy
- overuse of cards with no purpose

### Visual tone

Aim for a refined, modern, slightly editorial SaaS aesthetic.

Suggested direction:

- luminous neutrals
- a distinctive accent palette such as deep ink + electric cyan + soft aurora teal + warm highlight tones
- premium gradients
- glassy or softly elevated panels where appropriate
- elegant shadows
- large, confident hero composition

### UX quality bar

The app should feel like:

- a product someone could demo to investors
- a startup homepage that converts
- an onboarding flow that reassures new users
- a workspace that reduces overwhelm despite complex translation tasks

## Information Architecture

Build the app with a modular route and component structure.

Recommended sections:

- `/` public landing page
- `/sign-in[[...sign-in]]`
- `/sign-up[[...sign-up]]`
- `/documents`
- `/upload`
- `/validate?doc=...`
- `/translate?doc=...`
- `/glossary`
- `/documents/[documentId]`
- `/share/[shareId]` or equivalent shared route

Use route groups / layout separation where useful:

- public marketing layout
- authenticated app layout

## Required Landing Page

The landing page must be beautiful and conversion-focused.

Include:

- striking hero section with clear value proposition
- strong headline and subheadline
- primary CTA to start with Google
- secondary CTA to explore the product
- feature storytelling sections
- workflow section showing upload -> validate -> translate -> review -> export
- collaboration/share-link section
- glossary / terminology quality section
- premium mock product preview or dashboard showcase
- social-proof style presentation even if content is placeholder
- FAQ or trust section
- strong footer

Landing page should communicate:

- AI-assisted translation workflow
- reviewer control
- file fidelity
- team collaboration
- terminology consistency
- export readiness

## Authentication Requirements

Implement Clerk auth with Google.

Requirements:

- public landing page
- protected app routes
- middleware-based route protection
- clean sign-in and sign-up experience
- redirect users to app after auth
- preserve intended destination for protected/shared routes

### Important auth persistence requirement

Do **not** depend on Clerk webhooks for initial user persistence.

Implement an app-side sync flow so that after sign-in or sign-up:

- the Clerk user is checked in the database
- if missing, create the user
- if existing, update basic profile fields

Use a dedicated sync function on the server side, triggered from the authenticated app entry flow or layout, so there is no webhook dependency for core correctness.

Persist at least:

- clerk user id
- email
- name
- avatar url
- created at
- updated at

## Collaboration / File Sharing Requirement

Add a file sharing capability so multiple people can access the same translation file through a shareable link.

Important behavior:

- a signed-in user can generate a shareable link for a document
- another user opening the link should be able to access the same document context
- if the target user is not signed in, redirect to sign-in first
- after successful sign-in, redirect them back to the share destination

You may implement app-side persistence for sharing using Drizzle/Postgres.

Recommended share model:

- share id
- document id
- owner user id
- created at
- optional permission or access mode

Important limitation:

- do not invent unsupported translation backend behavior
- sharing is mainly for app access and collaboration context around the same document

## Drizzle + Postgres Requirements

Use Drizzle ORM with Postgres.

Create clean schema and modular DB organization for app-side data such as:

- users
- shared_documents or document_shares
- optional user preferences

Keep the schema well organized and production-friendly.

Suggested organization:

- `db/schema/*`
- `db/index.ts`
- `db/queries/*`
- `lib/auth/*`
- `lib/actions/*`

## Existing Backend Reality

The translation backend already exists and is the source of truth for translation workflow APIs.

Base API URL:

`http://localhost:8000`

Use `NEXT_PUBLIC_API_URL` in code.

Do not invent replacement backend endpoints for translation workflow.

## Existing Backend Endpoints To Include In Frontend Flow

Use these endpoints in the frontend where relevant:

- `GET /health`
- `POST /upload`
- `GET /documents`
- `GET /document/{document_id}`
- `DELETE /document/{document_id}`
- `POST /validate`
- `GET /translate/info`
- `POST /translate`
- `GET /segments/{document_id}`
- `POST /approve`
- `GET /glossary`
- `POST /glossary`
- `GET /export/status/{document_id}`
- `POST /export/{document_id}`

## Backend Contracts

Build around the backend exactly as described here.

### 1. `GET /health`

Response:

```json
{
  "status": "ok",
  "service": "translation-studio"
}
```

Use for:

- app boot health check
- backend status indicator

### 2. `POST /upload`

Purpose:

- upload a single PDF or DOCX

Request:

- `multipart/form-data`
- field: `file`

Success response:

```json
{
  "document_id": "uuid",
  "filename": "proposal.docx",
  "file_type": "docx",
  "blocks_parsed": 42,
  "message": "Document uploaded and processed successfully. 87 segments created."
}
```

### 3. `GET /documents`

Response:

```ts
type DocumentSummary = {
  id: string
  filename: string
  file_type: string
  created_at?: string | null
  blocks_count: number
  segments: {
    total: number
    pending: number
    reviewed: number
    approved: number
  }
  translation_progress: number
}
```

### 4. `GET /document/{document_id}`

Response:

```ts
type ParsedDocument = {
  id: string
  filename: string
  file_type: "pdf" | "docx"
  blocks: ParsedBlock[]
  created_at?: string
  metadata?: Record<string, unknown>
}

type ParsedBlock = {
  id: string
  document_id: string
  block_type: "heading" | "paragraph" | "table_cell" | "table"
  text: string
  level?: number
  row?: number
  col?: number
  table_index?: number
  position: {
    block_index: number
    sentence_index?: number | null
    phrase_index?: number | null
  }
}
```

### 5. `DELETE /document/{document_id}`

Use for destructive delete with confirmation UI.

### 6. `POST /validate`

Request:

```ts
type ValidateRequest = {
  document_id?: string
  text?: string
  auto_fix?: boolean
  enable_ai?: boolean
}
```

Response:

```ts
type ValidationIssue = {
  segment_id?: string | null
  issue_type:
    | "spelling"
    | "double_space"
    | "punctuation_spacing"
    | "consistency"
    | "grammar"
    | "style"
    | "space_before_punct"
    | "missing_space_after_punct"
    | "repeated_punctuation"
    | "clarity"
    | "wrong_word"
    | "punctuation"
  issue: string
  suggestion: string
  severity: "error" | "warning" | "info"
  offset?: number | null
  length?: number | null
  confidence?: number | null
  source?: string | null
}

type ValidationResult = {
  document_id?: string | null
  segment_id?: string | null
  text: string
  issues: ValidationIssue[]
  auto_fixed_text?: string | null
  has_errors: boolean
  has_warnings: boolean
}
```

### 7. `GET /translate/info`

Use for diagnostics/settings display if helpful.

### 8. `POST /translate`

Request:

```ts
type TranslateRequest = {
  document_id: string
  target_language?: string
  style_rules?: string[]
  segment_ids?: string[]
  pre_validate?: boolean
}
```

Response:

```ts
type Segment = {
  id: string
  document_id: string
  text: string
  type: string
  translated_text?: string | null
  correction?: string | null
  final_text?: string | null
  status: "pending" | "reviewed" | "approved" | "skip"
  parent_id?: string | null
  block_type: string
  position: {
    block_index: number
    sentence_index?: number | null
    phrase_index?: number | null
  }
  format_snapshot: Record<string, unknown>
  tm_match_type?: string | null
  tm_score?: number | null
  row?: number | null
  col?: number | null
  table_index?: number | null
  row_count?: number | null
  col_count?: number | null
  col_widths?: number[] | null
  created_at?: string
  updated_at?: string
}

type TranslateResponse = {
  document_id: string
  segments_translated: number
  segments: Segment[]
}
```

Important UI notes:

- skip segments are structural and should not be editable
- if `translated_text` starts with `"[ERROR"` highlight the row clearly
- translation memory badges should use values like `exact`, `fuzzy`, `new`

Visible output priority:

1. `final_text`
2. `correction`
3. `translated_text`
4. `text`

### 9. `GET /segments/{document_id}`

Query params:

- `status`
- `type`

Use for the main translation/review table.

### 10. `POST /approve`

Request:

```ts
type ApproveRequest = {
  segment_id: string
  correction?: string
  approved?: boolean
}
```

Use for:

- row-level save
- approve actions
- human correction persistence

### 11. `GET /glossary`

Response:

```ts
type GlossaryTerm = {
  source: string
  target: string
  language: string
  domain?: string | null
  notes?: string | null
}

type GlossaryResponse = {
  terms: GlossaryTerm[]
  style_rules: string[]
}
```

### 12. `POST /glossary`

Use for add/update glossary term.

Do not invent unsupported glossary delete/edit endpoints if they do not exist.

### 13. `GET /export/status/{document_id}`

Use for export readiness, warnings, and progress.

### 14. `POST /export/{document_id}`

Supports query params:

- `format=same|docx|pdf`
- `include_untranslated=true|false`

Handle blob download properly.

## Required Product Screens

### 1. Public landing page

Must feel premium and impressive.

### 2. Auth pages

Beautiful sign-in/sign-up with Google via Clerk.

### 3. Authenticated documents dashboard

Include:

- document list/cards
- progress
- quick actions
- recent activity feel
- CTA to upload new file

### 4. Upload experience

Include:

- drag-and-drop
- polished empty state
- file validation
- progress state
- success transition into workspace

### 5. Validation screen

Include:

- issue grouping
- severity indicators
- optional AI autofix display
- document-focused review flow

### 6. Translation workspace

This is a major screen and should feel excellent.

Include:

- target language controls
- progress overview
- translate action
- segment review UI
- inline editing
- approve actions
- clear status chips
- TM badges
- glossary alerts
- export controls
- responsive behavior

### 7. Glossary screen

Include:

- term list
- add/update form
- style rules presentation
- clean information layout

### 8. Shared document route

Include:

- share access handling
- redirect to auth when needed
- shared document context after login

## App Architecture Expectations

Use a modular structure. Prefer something like:

```txt
app/
  (marketing)/
  (auth)/
  (app)/
components/
  marketing/
  app-shell/
  documents/
  upload/
  validate/
  translate/
  glossary/
  shared/
lib/
  api/
  auth/
  db/
  shares/
  utils/
db/
  schema/
  queries/
```

## UX Rules

- make loading states beautiful
- make empty states intentional
- make error states calm and helpful
- preserve destination redirects
- use optimistic UI carefully
- prefer syncing from backend mutation responses
- disable duplicate in-flight actions
- keep important actions obvious
- ensure mobile usability, not just desktop scaling

## Route Protection Rules

- `/` is public
- Clerk auth pages are public
- all app routes are protected
- shared document routes still require auth, but must preserve redirect target

## Implementation Notes For v0

Generate real code, not a concept.

Include:

- Clerk setup
- middleware protection
- Drizzle schema
- Postgres connection setup
- user sync utility executed after authentication
- share-link persistence and resolution flow
- typed API layer for existing backend endpoints
- responsive layouts
- modular components

## Final Constraint

Do not simplify this into a generic dashboard.

Deliver a frontend that looks like a serious product launch: visually memorable, conversion-friendly, modular, responsive, and fully aligned with the existing backend workflow plus the added app-side auth/share/database requirements above.
