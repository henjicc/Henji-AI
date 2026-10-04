import { createLogger } from '@/core/logging'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MenuItem } from '../hooks/useContextMenu'
import { isDomNode, ownerDocumentOf } from '@/utils/crossRealmDom'
import { resolveUiOverlayTarget, useUiOverlayLayer } from '@/components/ui/overlayOwnership'

const logger = createLogger('components.ContextMenu')

interface ContextMenuProps {
    items: MenuItem[]
    position: { x: number; y: number }

    onClose: () => void
    visible: boolean
}

const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose, visible }) => {
    const menuRef = useRef<HTMLDivElement>(null)
    // 右键菜单是一层浮层：所在面板（如资产面板）据此认出它是自己的子浮层（任务 4.3）
    const overlay = useUiOverlayLayer(visible)
    // 菜单没有触发元素：可见期间在原位放一个隐藏锚点，得知自己处在主窗口还是剪辑系统浮窗，
    // 再挂到该文档的 body 并在该文档监听外部点击。
    const anchorRef = useRef<HTMLSpanElement>(null)
    const [host, setHost] = useState<Document | null>(null)
    useLayoutEffect(() => {
        if (!visible || !anchorRef.current) return
        const next = ownerDocumentOf(anchorRef.current)
        setHost(previous => previous === next ? previous : next)
    }, [visible])

    useEffect(() => {
        if (!visible || !host) return

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && (!isDomNode(e.target) || resolveUiOverlayTarget(e.target, overlay.id) === 'outside')) {
                onClose()
            }
        }

        // 延迟添加监听器，避免立即触发
        const timer = setTimeout(() => {
            host.addEventListener('mousedown', handleClickOutside)
        }, 0)

        return () => {
            clearTimeout(timer)
            host.removeEventListener('mousedown', handleClickOutside)
        }
    }, [visible, onClose, host, overlay.id])

    if (!visible) return null

    return <>
        <span ref={anchorRef} hidden />
        {host && createPortal(
        <div
            ref={menuRef}
            role="menu"
            data-context-menu
            {...overlay.layerProps}
            className="ui-glass context-menu animate-scale-in"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                maxHeight: 'calc(100vh - 20px)',
                maxWidth: 'calc(100vw - 20px)',
                overflowY: 'auto'
            }}
        >
            {items.map((item, index) => (
                <React.Fragment key={item.id}>
                    <div
                        role="menuitem"
                        aria-disabled={item.disabled === true}
                        tabIndex={item.disabled ? -1 : 0}
                        className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
                        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click() } }}
                        onClick={async (e) => {
                            const t0 = performance.now()
                            logger.info('[ContextMenu] 点击菜单项', { label: item.label, t0 })

                            e.preventDefault()
                            e.stopPropagation()
                            if (!item.disabled) {
                                onClose()
                                const t1 = performance.now()
                                logger.info('[ContextMenu] 菜单关闭, 等待 16ms', { 耗时: `${(t1 - t0).toFixed(2)}ms` })

                                // 菜单关闭后立即执行，16ms 足够一帧渲染
                                await new Promise(resolve => setTimeout(resolve, 16))

                                const t2 = performance.now()
                                logger.info('[ContextMenu] 16ms 等待结束, 执行 onClick', { 等待耗时: `${(t2 - t1).toFixed(2)}ms` })

                                await item.onClick()

                                const t3 = performance.now()
                                logger.info('[ContextMenu] onClick 执行完成', { onClick耗时: `${(t3 - t2).toFixed(2)}ms`, 总耗时: `${(t3 - t0).toFixed(2)}ms` })
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
        </div>, host.body
    )}
    </>
}

export default ContextMenu
