import React, { useEffect, useMemo, useRef } from 'react'
import { Image, LayoutGrid, Sparkles, Type, Upload } from 'lucide-react'
import { getMenuNodeDefinitions, type MenuIconKey } from '@/workspaces/canvas/domain/nodeRegistry'
import type { CanvasNodeType } from '@/workspaces/canvas/types'

interface NodeSelectionMenuProps {
  position: { x: number; y: number }
  onSelect: (type: CanvasNodeType) => void
  onClose: () => void
}

const iconMap: Record<MenuIconKey, typeof Upload> = {
  upload: Upload,
  sparkles: Sparkles,
  layout: LayoutGrid,
  text: Type,
}

export function NodeSelectionMenu({
  position,
  onSelect,
  onClose,
}: NodeSelectionMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const items = useMemo(() => getMenuNodeDefinitions(), [])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose()
    }
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="fixed z-[80] min-w-[220px] overflow-hidden rounded-lg border border-zinc-700 bg-[#151821] shadow-2xl"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item) => {
        const Icon = iconMap[item.menuIcon] ?? Image
        return (
          <button
            key={item.type}
            className="flex w-full items-center gap-3 border-b border-zinc-800/80 px-3 py-2 text-left text-xs text-zinc-200 transition-colors last:border-b-0 hover:bg-zinc-800/80"
            onClick={() => {
              onSelect(item.type)
              onClose()
            }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900">
              <Icon className="h-4 w-4 text-sky-300" />
            </span>
            {item.menuLabel}
          </button>
        )
      })}
    </div>
  )
}
