import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * 口播剪辑右栏的折叠行（设计稿 ToolAudioEdit：名称 + 当前值 + 箭头，34 高、悬停出底）。
 * 用原生 details/summary 保留键盘与读屏语义；名称单独包一层，`getByText(名称)` 能精确命中。
 */
export function AudioEditDisclosure({ title, value, children }: {
  title: string
  value?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <details className="group/disclosure">
      <summary className="-mx-2 flex min-h-control-md cursor-pointer list-none items-center justify-between gap-2 rounded-md px-2 text-13 text-text1 outline-none transition-colors duration-120 hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent-ring [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-text3">
          {value !== undefined ? <span className="truncate">{value}</span> : null}
          <ChevronRight size={14} aria-hidden="true" className="shrink-0 transition-transform duration-120 group-open/disclosure:rotate-90" />
        </span>
      </summary>
      <div className="flex flex-col gap-3 pb-3 pt-1.5">{children}</div>
    </details>
  )
}
