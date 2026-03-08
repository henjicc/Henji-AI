import React from 'react'

interface NodeFrameProps {
  title: string
  badge?: string
  children: React.ReactNode
}

export function NodeFrame({ title, badge, children }: NodeFrameProps): JSX.Element {
  return (
    <div className="w-[320px] rounded-xl border border-zinc-700/70 bg-panel/95 shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
      <div className="flex items-center justify-between border-b border-zinc-700/70 px-3 py-2">
        <div className="text-xs font-semibold text-zinc-200">{title}</div>
        {badge && (
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">
            {badge}
          </span>
        )}
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </div>
  )
}
