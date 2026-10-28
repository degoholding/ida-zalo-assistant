import { ExternalLink } from 'lucide-react'

import type { SharedLinkRecord } from '../types/shared-link'
import { isOpenableUrl } from '../utils/is-openable-url'

/** Ô "Link": tiêu đề thẻ link (nếu có) trên, đường dẫn dưới; bấm mở tab mới, không lộ trang nguồn cho trang đích. */
export function SharedLinkCell({ link }: { link: SharedLinkRecord }) {
  const label = link.title || link.url
  if (!isOpenableUrl(link.url)) return <span className="block truncate text-muted-foreground">{link.url}</span>
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.url}
      className="flex max-w-full min-w-0 items-start gap-1.5 text-left"
      onClick={(event) => event.stopPropagation()}
    >
      <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-primary hover:underline">{label}</span>
        {link.title && <span className="block truncate text-xs text-muted-foreground">{link.url}</span>}
      </span>
    </a>
  )
}
