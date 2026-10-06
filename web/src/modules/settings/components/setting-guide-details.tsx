import { BookOpen, ChevronRight, ExternalLink } from 'lucide-react'

const CONSOLE_URL = 'https://console.cloud.google.com'

interface SettingGuideDetailsProps {
  title: string
  steps: string[]
}

/**
 * Hướng dẫn từng bước, MẶC ĐỊNH THU GỌN — chỉ cần lúc cài lần đầu; mở sẵn thì mỗi lần vào tab phải cuộn qua cả trang chữ.
 * `<details>` gốc của trình duyệt: đủ dùng, khỏi kéo thêm thư viện cho một khối gập / mở.
 */
export function SettingGuideDetails({ title, steps }: SettingGuideDetailsProps) {
  return (
    <details className="group rounded-md border bg-background">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        <BookOpen className="size-4 text-muted-foreground" />
        {title}
      </summary>
      <div className="space-y-3 border-t px-4 py-3">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <a
          href={CONSOLE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Mở Google Cloud Console <ExternalLink className="size-3.5" />
        </a>
      </div>
    </details>
  )
}
