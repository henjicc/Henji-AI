import { useState, useCallback } from 'react'

export interface MenuItem {
    id: string
    label: string
    icon: React.ReactNode
    onClick: () => void
    disabled?: boolean
    divider?: boolean
    /** 悬停可看全的完整文字（如被截断的路径）。 */
    title?: string
}

/**
 * 菜单锚点：右键时是指针位置；从按钮打开（`showMenuAt`）时带上按钮元素，菜单右缘对齐按钮、贴在下方，
 * 并按按钮实时位置定位。视口夹取、上下翻转与宽度都由 `ContextMenu`（共享浮层 `PanelTrigger` 锚点模式）负责。
 */
export interface MenuPosition {
    x: number
    y: number
    anchor?: Element
}

interface UseContextMenuReturn {
    menuVisible: boolean
    menuPosition: MenuPosition
    menuItems: MenuItem[]
    showMenu: (e: React.MouseEvent, items: MenuItem[]) => void
    /** 从按钮（如卡片上的“更多”）打开同一份菜单：右缘对齐按钮、贴在按钮下方，键盘触发也能定位。 */
    showMenuAt: (anchor: Element, items: MenuItem[]) => void
    hideMenu: () => void
}

/**
 * 右键菜单状态。点外关闭、Escape、所在文档（主窗口或剪辑系统浮窗）由 `ContextMenu` 统一处理（任务 5.9），
 * 这里只记录菜单项与锚点。
 */
export const useContextMenu = (): UseContextMenuReturn => {
    const [menuVisible, setMenuVisible] = useState(false)
    const [menuPosition, setMenuPosition] = useState<MenuPosition>({ x: 0, y: 0 })
    const [menuItems, setMenuItems] = useState<MenuItem[]>([])

    const showMenu = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
        e.preventDefault()
        e.stopPropagation()
        setMenuItems(items)
        setMenuPosition({ x: e.clientX, y: e.clientY })
        setMenuVisible(true)
    }, [])

    const showMenuAt = useCallback((anchor: Element, items: MenuItem[]) => {
        const rect = anchor.getBoundingClientRect()
        setMenuItems(items)
        setMenuPosition({ x: rect.right, y: rect.bottom, anchor })
        setMenuVisible(true)
    }, [])

    const hideMenu = useCallback(() => {
        setMenuVisible(false)
    }, [])

    return {
        menuVisible,
        menuPosition,
        menuItems,
        showMenu,
        showMenuAt,
        hideMenu
    }
}
