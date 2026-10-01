---
name: icons
description: Use lucide-react icons. No emoji-as-icon, no gradient-colored icons.
metadata:
  tags: icons, lucide, emoji, gradient
---

# Icons

Icons come from the project's icon library — **`lucide-react`**. Nothing else.

```tsx
import { Check, Trash2 } from "lucide-react";

<Button>
  <Check className="size-4" />
  Save
</Button>;
```

## Rules

- **Always** import icons from `lucide-react`. If an icon isn't in lucide, pick the closest lucide match before considering another source.
- **Never use emoji as icons** (`✅`, `🔥`, `⚠️`, `🚀`, …) in UI — not in buttons, labels, headings, empty states, or toasts. Emoji render inconsistently across platforms and can't be styled. Use a lucide icon instead.
- **No gradient-colored icons.** Color icons with a single semantic token via `currentColor` / Tailwind text color (`text-muted-foreground`, `text-destructive`, …). No `bg-clip-text`, no gradient fills/strokes on icons.
- Size with Tailwind (`className="size-4"`), not width/height attributes. Inline icons in buttons/text are typically `size-4`.
- Icons inherit color from text by default (`currentColor`) — prefer that over hard-coding a color on the icon.
