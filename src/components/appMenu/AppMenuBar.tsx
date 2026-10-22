import React, { useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { UiButton, UiOptionButton } from '@/components/ui'
import { UI_GLASS_ADAPTIVE_DIVIDER_CLASS } from '@/components/ui/styleTokens'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { getAppMenus, subscribeAppMenus, type AppMenu, type AppMenuEntry } from '@/core/appMenu/appMenu'
import { createLogger } from '@/core/logging'

const logger = createLogger('components.appMenu')
const ENABLED_ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])'
const noDrag: React.CSSProperties & { WebkitAppRegion: 'no-drag' } = { WebkitAppRegion: 'no-drag' }

/**
 * 标题栏菜单栏（Windows；macOS 用同一份模型生成系统菜单栏，见 core/appMenu）。
 * 行为按桌面惯例：点开一个菜单后，指针移到其他菜单名上直接切换；左右方向键在菜单之间切换，上下键在菜单项之间移动；
 * 菜单项右侧显示快捷键，不可用时灰显并在悬停说明里写原因。菜单项执行的都是工作区登记的正式操作。
 */
export function AppMenuBar(): React.ReactElement | null {
  const menus = useSyncExternalStore(subscribeAppMenus, getAppMenus)
  const [openId, setOpenId] = useState<string | null>(null)
  if (!menus.length) return null
  const move = (step: number): void => {
    const index = menus.findIndex(menu => menu.id === openId)
    setOpenId(String(menus[(index + step + menus.length) % menus.length].id))
  }
  return <nav aria-label="菜单栏" role="menubar" className="flex min-w-0 items-center" style={noDrag} data-window-nodrag data-app-menubar>
    {menus.map(menu => <AppMenuButton key={menu.id} menu={menu} open={openId === menu.id}
      onOpenChange={open => setOpenId(open ? String(menu.id) : current => current === menu.id ? null : current)}
      onHover={() => { if (openId && openId !== menu.id) setOpenId(String(menu.id)) }}
      onMove={move} />)}
  </nav>
}

function AppMenuButton({ menu, open, onOpenChange, onHover, onMove }: { menu: AppMenu; open: boolean; onOpenChange: (open: boolean) => void; onHover: () => void; onMove: (step: number) => void }): React.ReactElement {
  return <PanelTrigger open={open} onOpenChange={onOpenChange} panelSize="menu" panelPadding="menu" zIndex={Z_LAYERS.dropdown}
    renderPanel={() => <AppMenuList items={menu.items} label={menu.label} onClose={() => onOpenChange(false)} onMove={onMove} />}>
    {({ togglePanel }) => <UiButton size="sm" role="menuitem" aria-haspopup="menu" aria-expanded={open} data-panel-trigger-button data-app-menu={menu.id}
      onPointerEnter={onHover} onClick={togglePanel}
      onKeyDown={event => {
        // 焦点还在菜单名上时（刚点开），左右键同样在菜单之间切换，下键打开并进入菜单。
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); if (open) onMove(event.key === 'ArrowLeft' ? -1 : 1) }
        else if (event.key === 'ArrowDown' && !open) { event.preventDefault(); togglePanel() }
      }}>{menu.label}</UiButton>}
  </PanelTrigger>
}

function AppMenuList({ items, label, onClose, onMove }: { items: readonly AppMenuEntry[]; label: string; onClose: () => void; onMove?: (step: number) => void }): React.ReactElement {
  const listRef = useRef<HTMLDivElement>(null)
  const [submenu, setSubmenu] = useState<{ id: string; anchor: { left: number; top: number; bottom: number; width: number } } | null>(null)
  React.useEffect(() => { listRef.current?.focus({ preventScroll: true }) }, [])
  const keyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const list = listRef.current
    if (!list) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { if (onMove && !submenu) { event.preventDefault(); onMove(event.key === 'ArrowLeft' ? -1 : 1) } return }
    const enabled = Array.from(list.querySelectorAll<HTMLElement>(`:scope > ${ENABLED_ITEM_SELECTOR}`))
    if (!enabled.length) return
    const current = enabled.indexOf(list.ownerDocument.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (current + 1) % enabled.length : event.key === 'ArrowUp' ? (current - 1 + enabled.length) % enabled.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : null
    if (next === null) return
    event.preventDefault(); enabled[next]?.focus()
  }
  const run = (item: Extract<AppMenuEntry, { kind: 'command' }>): void => {
    if (item.disabledReason) return
    onClose()
    // 先让菜单收起一帧再执行：动作可能打开弹窗或做重活。
    window.setTimeout(() => {
      const fail = (error: unknown): void => logger.error('菜单项执行失败', { event: 'app_menu.run_failed', error, context: { id: item.id } })
      try { void Promise.resolve(item.run()).catch(fail) } catch (error) { fail(error) }
    }, 16)
  }
  return <div ref={listRef} role="menu" aria-label={label} tabIndex={-1} className="flex min-w-48 flex-col outline-none" onKeyDown={keyDown}>
    {items.map((item, index) => {
      if (item.kind === 'separator') return <div key={`separator-${index}`} role="separator" className={`my-1 border-t ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`} />
      if (item.kind === 'submenu') {
        const opened = submenu?.id === item.id
        return <React.Fragment key={item.id}>
          <UiOptionButton role="menuitem" variant="menu" size="sm" aria-haspopup="menu" aria-expanded={opened} aria-disabled={Boolean(item.disabledReason)} tooltip={item.disabledReason}
            className="w-full gap-2" onPointerEnter={event => { if (item.disabledReason) return; const rect = event.currentTarget.getBoundingClientRect(); setSubmenu({ id: item.id, anchor: { left: rect.right, top: rect.top - 4, bottom: rect.top - 4, width: 0 } }) }}
            onClick={event => { if (item.disabledReason) return; const rect = event.currentTarget.getBoundingClientRect(); setSubmenu(opened ? null : { id: item.id, anchor: { left: rect.right, top: rect.top - 4, bottom: rect.top - 4, width: 0 } }) }}>
            <span aria-hidden="true" className="w-3.5 shrink-0" />
            <span className={`min-w-0 flex-1 truncate ${item.disabledReason ? 'text-text3' : ''}`}>{item.label}</span>
            <ChevronRight size={UI_ICON_SIZE.sm} className="shrink-0 text-text3" aria-hidden="true" />
          </UiOptionButton>
          {opened && <PanelTrigger anchor={submenu.anchor} open onOpenChange={next => { if (!next) setSubmenu(null) }} panelSize="menu" panelPadding="menu" zIndex={Z_LAYERS.dropdown}
            renderPanel={() => <AppMenuList items={item.items} label={item.label} onClose={() => { setSubmenu(null); onClose() }} />} />}
        </React.Fragment>
      }
      return <UiOptionButton key={item.id} role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} {...(item.checked === undefined ? {} : { 'aria-checked': item.checked })}
        variant="menu" size="sm" aria-disabled={Boolean(item.disabledReason)} tooltip={item.disabledReason} className="w-full gap-2" data-app-menu-item={item.id}
        onPointerEnter={() => setSubmenu(null)}
        onKeyDown={event => { if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); event.stopPropagation(); run(item) }}
        onClick={event => { event.preventDefault(); event.stopPropagation(); run(item) }}>
        <span aria-hidden="true" className="flex w-3.5 shrink-0 justify-center">{item.checked ? <Check size={UI_ICON_SIZE.sm} /> : null}</span>
        <span className={`min-w-0 flex-1 truncate ${item.disabledReason ? 'text-text3' : item.danger ? 'text-danger-text' : ''}`}>{item.label}</span>
        {item.shortcut && <span className="ml-6 shrink-0 text-xs tabular-nums text-text3">{item.shortcut}</span>}
      </UiOptionButton>
    })}
  </div>
}
