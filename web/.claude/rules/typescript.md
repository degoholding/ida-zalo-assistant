---
name: typescript
description: TypeScript conventions — component props and avoiding `any`.
metadata:
  tags: typescript, props, types, any
---

# TypeScript

Strict mode is on (`tsconfig.json`), plus `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch` and `verbatimModuleSyntax`. Write code the next reader
(human or AI) understands without running it.

`npm run typecheck` (`tsc --noEmit`) must stay at **zero errors** — that is the only
compile-time gate this app has, so do not let it drift.

## Component props

- Define props inline for tiny components, or as a named `interface` when reused/exported:
  ```tsx
  interface EmployeeListProps {
    items: Employee[]
    onSelect?: (id: number) => void
    className?: string
  }

  export function EmployeeList({ items, onSelect, className }: EmployeeListProps) { … }
  ```
- Name the props type `<Component>Props`.
- Destructure props in the signature — don't reach into a `props` object.
- Components that render children type them as `React.ReactNode`.
- Reuse domain types from the module's `types/` folder (e.g.
  `@/modules/hr/types/employee`); don't redefine shapes inline.

## Avoid `any`

- `any` is a last resort, not a default. Prefer:
  - a concrete type or `interface`,
  - `unknown` + a narrowing check when the shape is truly unknown (e.g. caught errors, external JSON),
  - generics for reusable helpers.
- Type API responses explicitly: `apiGet<Employee[]>('/api/employees')`. The
  `apiGet/apiPost/apiPatch/apiDelete` helpers in `@/core/api` already strip the
  backend envelope `{ success, message, data }`, so the type parameter is the
  payload itself — not the envelope.
- If `any` is genuinely unavoidable, isolate it behind a typed boundary and leave a
  `// why:` comment. Never let `any` leak into a public/exported signature.

## General

- Let TypeScript infer local variables; annotate function boundaries (params + return when non-obvious) and exported APIs.
- Use `import type { … }` for type-only imports. With `verbatimModuleSyntax` a plain
  `import` of a type will survive into the bundle and break — this is not optional.
- No non-null `!` assertions — narrow instead.
- `import.meta.env` vars are declared in `src/vite-env.d.ts`; add new `VITE_*` vars
  there rather than casting.

## No framework-generated types

This is a **Vite SPA**, not Next.js. There is no `next build`, no `.next/types`, no
`LayoutProps` / `PageProps`, no Promise-wrapped `params`. Routing types come from
`react-router-dom` (`useParams()` returns `Record<string, string | undefined>` — parse
the id yourself and handle the undefined branch) and from
`src/app/router/module-definition.ts` for module/route shapes.
