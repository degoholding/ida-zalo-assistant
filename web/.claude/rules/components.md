---
name: components
description: How to source, place, and build UI components in this project.
metadata:
  tags: components, shadcn, ui, radix, vite
---

# Components

This app is a **Vite SPA** (React 19 + react-router-dom 7). There is no Next.js,
no App Router, no Server Components, no `"use client"`. Every component runs in
the browser.

## Where components live

- Generic, cross-module UI → `src/shared/ui/` (this is where shadcn primitives land:
  `button.tsx`, `dialog.tsx`, `table.tsx`, …). Alias: `@/shared/ui/<name>`.
- Bigger shared building blocks with their own folder → `src/shared/<area>/`
  (`data-table/`, `conditional-filter/`, `notifications/`, `audit/`).
- Module-specific components → `src/modules/<module>/components/` (never in `shared/`).
  A module folder is `api/ · components/ · config/ · hooks/ · pages/ · types/ · utils/ · routes.tsx`.
- App shells, layouts, providers, router → `src/app/`. Cross-cutting infrastructure
  (http client, auth, permissions, i18n, config) → `src/core/`.

**There are no barrel files.** Import the exact file:
`import { EmployeeFormDialog } from '@/modules/hr/components/employee-form-dialog'`.
Do not add `index.ts` barrels to modules — the only barrels that exist are for
self-contained shared kits (`@/shared/conditional-filter`, `@/core/api`).

A module may import from `@/shared/**` and `@/core/**` freely. A module importing
another module's internals is a smell — lift the shared piece into `shared/`.

## Sourcing policy (in strict priority order)

When you need a UI component, decide in this order — do NOT hand-roll something
shadcn already ships:

1. **shadcn/ui first.** If it exists in shadcn, install it:
   ```bash
   docker compose exec erp npx shadcn@latest add <component>   # dialog, input, card, table…
   ```
   It lands in `src/shared/ui/` (see the `aliases` block in `components.json`).
   Config: style `new-york`, baseColor `slate`, `rsc: false`, icons lucide,
   CSS entry `src/index.css`. Primitives are built on **Radix**
   (`radix-ui` + the `@radix-ui/react-*` packages), NOT Base UI.
2. **Another library** only if shadcn does NOT have it (rich text → tiptap,
   charts → recharts, calendar → react-day-picker, toasts → sonner — all already
   installed). Prefer well-maintained, Tailwind-friendly libs. Add a one-line
   comment noting why the external lib was chosen.
3. **Custom** only when the component is trivial (a badge, a layout wrapper, a
   simple state display). Keep it small, colocate it, style with `cn` + Tailwind.

Rule of thumb: shadcn > library > custom. Reach for custom only when it's
genuinely simpler than pulling a dependency.

## Building a component

- Never guess whether a shadcn component exists — check the registry
  (`npx shadcn@latest add <name>` will tell you) before writing it by hand.
- Treat the plain shadcn files in `src/shared/ui/` as generated: edit them only to
  wire variants. Files in that folder that are clearly ours (`page-header.tsx`,
  `record-identity-card.tsx`, `form-stepper.tsx`, `module-dashboard.tsx`,
  `delete-confirm-button.tsx`, the chart wrappers…) are normal code — edit freely.
- Compose shadcn primitives instead of duplicating their markup.
- Icons come from `lucide-react` (see `icons.md`).
- Data lists use `@/shared/data-table` — read `docs/ui/table.md` before building a
  list screen by hand. Date inputs: `docs/ui/date.md`.

## Data, not props drilling

- Server state comes from TanStack Query hooks in `src/modules/<module>/hooks/`,
  which call the module's `api/` functions on top of `@/core/api`. Components do
  not call `axios` directly.
- Query keys come from `@/shared/constants/query-keys` — never inline a raw key
  string, or invalidation will silently miss.
