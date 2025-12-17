import React, { useEffect, useRef } from 'react'
import { MenuItem } from '../hooks/useContextMenu'

interface ContextMenuProps {
    items: MenuItem[]
    position: { x: number; y: number }
    onClose: () => void
    visible: boolean
}

const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose, visible }) => {
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!visible) return

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose()
            }
        }

        // 延迟添加监听器，避免立即触发
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside)
        }, 0)

        return () => {
            clearTimeout(timer)
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [visible, onClose])

    if (!visible) return null

    return (
        <div
            ref={menuRef}
            data-context-menu
            className="context-menu animate-scale-in"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`
            }}
        >
            {items.map((item, index) => (
                <React.Fragment key={item.id}>
                    <div
                        className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
                        onClick={async (e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (!item.disabled) {
                                onClose()
                                // 等待一小段时间确保菜单关闭动画完成，然后执行操作
                                await new Promise(resolve => setTimeout(resolve, 50))
                                await item.onClick()
                            }
                        }}
                    >
                        <div className="context-menu-icon">{item.icon}</div>
                        <span>{item.label}</span>
                    </div>
                    {item.divider && index < items.length - 1 && (
                        <div className="context-menu-divider" />
                    )}
                </React.Fragment>
            ))}
        </div>
    )
}

export default ContextMenu
