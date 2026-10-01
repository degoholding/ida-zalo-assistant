---
name: styling
description: Tailwind + cn() styling conventions. No string-concatenated class names.
metadata:
  tags: styling, tailwind, cn, classnames
---

# Styling

Tailwind CSS v4. Theme tokens live in **`src/index.css`** (`:root` / `.dark` CSS
variables in `oklch()`, then `@theme inline`, then a `@layer base`). There is no
`tailwind.config.*` — v4 is configured entirely from CSS, wired in through the
`@tailwindcss/vite` plugin. Use semantic tokens (`bg-background`,
`text-muted-foreground`, `border-input`, …), not raw hex.

Adding a colour means adding a variable to BOTH `:root` and `.dark`, then exposing
it in `@theme inline`. A one-off hex in a component is a bug — dark mode will break.

## Always merge classes with `cn()`

`cn` (**`@/shared/utils/cn`**) = `clsx` + `tailwind-merge`. It composes conditional
classes AND resolves Tailwind conflicts (last wins).

```tsx
import { cn } from '@/shared/utils/cn'

<div className={cn('rounded-md border p-4', isActive && 'bg-accent', className)} />
```

## NEVER build class strings by concatenation

Template strings and `+` skip conflict resolution and read poorly.

```tsx
// FORBIDDEN
<div className={`p-4 ${isActive ? 'bg-accent' : ''} ${className}`} />
<div className={'p-4 ' + (isActive ? 'bg-accent' : '')} />

// REQUIRED
<div className={cn('p-4', isActive && 'bg-accent', className)} />
```

- Conditional classes → pass as separate `cn` args (`condition && 'class'`), not ternaries inside a template.
- Variant-heavy components → use `class-variance-authority` (`cva`), the shadcn pattern.
- A component that accepts styling overrides takes a `className?: string` prop and merges it LAST inside `cn`.
- Prefer Tailwind utilities over inline `style={{}}`; use `style` only for truly dynamic values (computed positions, colors from data).
- No emoji anywhere in the UI or in source files — see `icons.md`.
