import { createLogger } from '@/core/logging'
import React, { useEffect, useRef, type KeyboardEvent } from 'react'
import type { MenuItem, MenuPosition } from '../hooks/useContextMenu'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { UiOptionButton } from '@/components/ui/primitives'
import { UI_GLASS_ADAPTIVE_DIVIDER_CLASS, type UiTriggerPanelSurface } from '@/components/ui/styleTokens'

const logger = createLogger('components.ContextMenu')

interface ContextMenuProps {
    items: MenuItem[]
    position: MenuPosition

    onClose: () => void
    visible: boolean
    /** 浮层表面：默认实底；菜单压在画布、图片、视频上时传 `glass`（与 `PanelTrigger` / `Dropdown` 同一枚举）。 */
    surface?: UiTriggerPanelSurface
}

const ENABLED_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)'

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }): React.ReactElement {
    const listRef = useRef<HTMLDivElement>(null)

    // 打开即让菜单获得焦点：方向键可选择、Enter 执行（菜单本身不显示焦点环，避免鼠标打开时出现框）。
    // 文本框里的右键（全局粘贴菜单）不抢走输入焦点，粘贴后仍可接着输入。
    useEffect(() => {
        const list = listRef.current
        const active = list?.ownerDocument.activeElement as HTMLElement | null | undefined
        if (active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
        list?.focus({ preventScroll: true })
    }, [])

    const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
        const list = listRef.current
        if (!list) return
        const enabled = Array.from(list.querySelectorAll<HTMLElement>(ENABLED_ITEM_SELECTOR))
        if (enabled.length === 0) return
        const current = enabled.indexOf(list.ownerDocument.activeElement as HTMLElement)
        let next: number | null = null
        if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % enabled.length
        else if (event.key === 'ArrowUp') next = current < 0 ? enabled.length - 1 : (current - 1 + enabled.length) % enabled.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = enabled.length - 1
        if (next === null) return
        event.preventDefault()
        enabled[next]?.focus()
    }

    const run = async (item: MenuItem): Promise<void> => {
        if (item.disabled) return
        logger.info('[ContextMenu] 执行菜单项', { label: item.label })
        onClose()
        // 先让菜单收起一帧，再执行（动作可能打开弹窗或做重活）
        await new Promise(resolve => setTimeout(resolve, 16))
        await item.onClick()
    }

    return (
        <div
            ref={listRef}
            role="menu"
            tabIndex={-1}
            data-context-menu
            className="flex min-w-44 max-w-sm flex-col outline-none"
            onKeyDown={moveFocus}
        >
            {items.map((item, index) => (
                <React.Fragment key={item.id}>
                    <UiOptionButton
                        type="button"
                        role="menuitem"
                        variant="menu"
                        size="md"
                        disabled={item.disabled === true}
                        aria-disabled={item.disabled === true}
                        title={item.title}
                        className="w-full gap-2.5"
                        onKeyDown={event => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            // 阻止按钮原生激活，避免同一次按键执行两遍
                            event.preventDefault()
                            event.stopPropagation()
                            void run(item)
                        }}
                        onClick={event => {
                            event.preventDefault()
                            event.stopPropagation()
                            void run(item)
                        }}
                    >
                        {item.icon ? <span aria-hidden="true" className="flex shrink-0 items-center text-text2">{item.icon}</span> : null}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </UiOptionButton>
                    {item.divider && index < items.length - 1 && (
                        <div role="separator" className={`my-1 border-t ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`} />
                    )}
                </React.Fragment>
            ))}
        </div>
    )
}

/**
 * 右键菜单与按钮菜单（任务 5.9 收敛）：浮层本身走 `PanelTrigger` 的锚点模式，与下拉、参数面板共用
 * 定位（视口夹取、上下翻转）、浮层归属（子浮层与模态层）、Escape 只关最上层、跨文档挂载；
 * 菜单项是 `UiOptionButton variant="menu"`，悬停、禁用、玻璃自适应与其他菜单一致。宽度按内容（176–384）。
 */
const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose, visible, surface = 'solid' }) => {
    const anchor = position.anchor ?? { left: position.x, top: position.y, bottom: position.y, width: 0 }
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose
    return (
        <PanelTrigger
            anchor={anchor}
            open={visible}
            onOpenChange={next => { if (!next) onCloseRef.current() }}
            alignment={position.anchor ? 'bottomRight' : 'bottomLeft'}
            surface={surface}
            panelPadding="menu"
            panelWidth="content"
            renderPanel={() => <MenuList items={items} onClose={onClose} />}
        />
    )
}

export default ContextMenu
