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
        const itemHeight = 36 // 每个菜单项的大概高度
        const padding = 16 // 菜单的上下 padding
        const estimatedHeight = items.length * itemHeight + padding

        // 获取视口尺寸
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        // 计算菜单位置，确保不会超出视口
        let x = e.clientX
        let y = e.clientY

        // 检查右边界
        if (x + menuRef.current.width > viewportWidth) {
            x = viewportWidth - menuRef.current.width - 10
        }

        // 检查底部边界
        if (y + estimatedHeight > viewportHeight) {
            y = viewportHeight - estimatedHeight - 10
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

        const handleClick = () => {
            hideMenu()
        }

        const handleContextMenu = () => {
            // 如果右键点击的不是菜单本身，关闭菜单
            hideMenu()
        }

        // 延迟添加事件监听器，避免立即触发
        const timer = setTimeout(() => {
            document.addEventListener('click', handleClick)
            document.addEventListener('contextmenu', handleContextMenu)
        }, 0)

        return () => {
            clearTimeout(timer)
            document.removeEventListener('click', handleClick)
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
