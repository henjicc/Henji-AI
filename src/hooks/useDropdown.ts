/**
 * useDropdown Hook
 *
 * 管理下拉面板的打开/关闭状态和定位
 */

import { useState, useEffect, useCallback, RefObject } from 'react'

interface DropdownPosition {
  top: number
  left: number
  width: number
}

interface UseDropdownReturn {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  panelPosition: DropdownPosition
}

export function useDropdown(triggerRef: RefObject<HTMLElement>): UseDropdownReturn {
  const [isOpen, setIsOpen] = useState(false)
  const [panelPosition, setPanelPosition] = useState<DropdownPosition>({
    top: 0,
    left: 0,
    width: 0
  })

  // 计算面板位置
  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top

    // 默认向下展开，如果下方空间不足且上方空间更多，则向上展开
    const shouldFlipUp = spaceBelow < 200 && spaceAbove > spaceBelow

    setPanelPosition({
      top: shouldFlipUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width
    })
  }, [triggerRef])

  // 打开面板
  const open = useCallback(() => {
    setIsOpen(true)
    calculatePosition()
  }, [calculatePosition])

  // 关闭面板
  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  // 切换面板
  const toggle = useCallback(() => {
    if (isOpen) {
      close()
    } else {
      open()
    }
  }, [isOpen, open, close])

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(event.target as Node)) {
        // 检查是否点击在面板内
        const panels = document.querySelectorAll('.dropdown-panel')
        let clickedInPanel = false
        panels.forEach(panel => {
          if (panel.contains(event.target as Node)) {
            clickedInPanel = true
          }
        })
        if (!clickedInPanel) {
          close()
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, close, triggerRef])

  // 窗口大小变化时重新计算位置
  useEffect(() => {
    if (!isOpen) return

    const handleResize = () => calculatePosition()
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize, true)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleResize, true)
    }
  }, [isOpen, calculatePosition])

  return {
    isOpen,
    open,
    close,
    toggle,
    panelPosition
  }
}
