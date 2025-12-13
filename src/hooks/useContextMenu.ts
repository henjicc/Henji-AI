import { useState, useEffect, useCallback, useRef } from 'react'

export interface MenuItem {
    id: string
    label: string
    icon: React.ReactNode
    onClick: () => void
    disabled?: boolean
    divider?: boolean
}

interface Position {
    x: number
    y: number
}

interface UseContextMenuReturn {
    menuVisible: boolean
    menuPosition: Position
    menuItems: MenuItem[]
    showMenu: (e: React.MouseEvent, items: MenuItem[]) => void
    hideMenu: () => void
}

export const useContextMenu = (): UseContextMenuReturn => {
    const [menuVisible, setMenuVisible] = useState(false)
    const [menuPosition, setMenuPosition] = useState<Position>({ x: 0, y: 0 })
    const [menuItems, setMenuItems] = useState<MenuItem[]>([])
    const menuRef = useRef<{ width: number; height: number }>({ width: 200, height: 0 })

    const showMenu = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
        e.preventDefault()
        e.stopPropagation()

        setMenuItems(items)

        // 计算菜单高度（估算）
        const itemHeight = 40 // 每个菜单项的大概高度
        const padding = 8 // 菜单的上下 padding
        const estimatedHeight = items.length * itemHeight + padding
        const menuWidth = menuRef.current.width

        // 获取视口尺寸
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        // 使用 clientX/clientY（相对于视口的坐标）
        let x = e.clientX
        let y = e.clientY

        // 如果菜单会超出右边界，向左偏移
        if (x + menuWidth > viewportWidth - 10) {
            x = viewportWidth - menuWidth - 10
        }

        // 如果菜单会超出底部边界，向上显示
        if (y + estimatedHeight > viewportHeight - 10) {
            y = y - estimatedHeight
        }

        // 确保不会超出左边界和顶部
        x = Math.max(10, x)
        y = Math.max(10, y)

        setMenuPosition({ x, y })
        setMenuVisible(true)
    }, [])

    const hideMenu = useCallback(() => {
        setMenuVisible(false)
    }, [])

    // 点击外部关闭菜单
    useEffect(() => {
        if (!menuVisible) return

        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            // 如果点击的不是菜单内部，关闭菜单
            if (!target.closest('[data-context-menu]')) {
                hideMenu()
            }
        }

        const handleContextMenu = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            // 如果右键点击的不是菜单本身，关闭菜单
            if (!target.closest('[data-context-menu]')) {
                hideMenu()
            }
        }

        // 延迟添加事件监听器，避免立即触发
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClick)
            document.addEventListener('contextmenu', handleContextMenu)
        }, 10)

        return () => {
            clearTimeout(timer)
            document.removeEventListener('mousedown', handleClick)
            document.removeEventListener('contextmenu', handleContextMenu)
        }
    }, [menuVisible, hideMenu])

    return {
        menuVisible,
        menuPosition,
        menuItems,
        showMenu,
        hideMenu
    }
}
