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
                            const t0 = performance.now()
                            console.log('[ContextMenu] 点击菜单项', { label: item.label, t0 })

                            e.preventDefault()
                            e.stopPropagation()
                            if (!item.disabled) {
                                onClose()
                                const t1 = performance.now()
                                console.log('[ContextMenu] 菜单关闭, 等待 16ms', { 耗时: `${(t1 - t0).toFixed(2)}ms` })

                                // 菜单关闭后立即执行，16ms 足够一帧渲染
                                await new Promise(resolve => setTimeout(resolve, 16))

                                const t2 = performance.now()
                                console.log('[ContextMenu] 16ms 等待结束, 执行 onClick', { 等待耗时: `${(t2 - t1).toFixed(2)}ms` })

                                await item.onClick()

                                const t3 = performance.now()
                                console.log('[ContextMenu] onClick 执行完成', { onClick耗时: `${(t3 - t2).toFixed(2)}ms`, 总耗时: `${(t3 - t0).toFixed(2)}ms` })
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
