import React, { useEffect, useMemo, useRef } from 'react'
import { Image, LayoutGrid, Sparkles, Type, Upload } from 'lucide-react'
import { getMenuNodeDefinitions, type MenuIconKey } from '@/workspaces/canvas/domain/nodeRegistry'
import type { CanvasNodeType } from '@/workspaces/canvas/types'
import { UiOptionButton, UiPanel } from '@/components/ui'

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
      className="fixed z-[80] min-w-[220px]"
      style={{ left: position.x, top: position.y }}
    >
      <UiPanel className="overflow-hidden rounded-lg">
        {items.map((item) => {
          const Icon = iconMap[item.menuIcon] ?? Image
          return (
            <UiOptionButton
              type="button"
              active={false}
              key={item.type}
              className="w-full rounded-none border-x-0 border-t-0 border-b border-zinc-800/80 px-3 py-2 text-xs last:border-b-0"
              onClick={() => {
                onSelect(item.type)
                onClose()
              }}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900">
                <Icon className="h-4 w-4 text-sky-300" />
              </span>
              {item.menuLabel}
            </UiOptionButton>
          )
        })}
      </UiPanel>
    </div>
  )
}
