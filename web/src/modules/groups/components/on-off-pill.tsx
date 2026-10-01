import { Pill } from '@/shared/ui/pill'

/** Ô bật / tắt trong bảng: bật thì nhãn xanh, tắt thì chữ xám nhạt. */
export function OnOffPill({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return on ? <Pill tone="done">{onLabel}</Pill> : <span className="text-xs text-muted-foreground">{offLabel}</span>
}
