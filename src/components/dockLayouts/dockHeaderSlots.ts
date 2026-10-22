import { useSyncExternalStore } from 'react'

/**
 * 面板标签行插槽的登记（剪辑、音频编辑等停靠工作区共用）：标签行右端挂一个容器，按“工作区:面板”登记；
 * 面板据此把自己的工具放进去。面板组太窄时宿主不登记，工具留在面板内部，标签不会被挤进溢出列表。
 */
const slots = new Map<string, HTMLElement>()
const listeners = new Set<() => void>()
let revision = 0
const publish = (): void => { revision++; listeners.forEach(listener => listener()) }

export function setDockHeaderSlot(panelId: string, element: HTMLElement | null): void {
  if (element) { if (slots.get(panelId) === element) return; slots.set(panelId, element) }
  else if (!slots.delete(panelId)) return
  publish()
}

export function useDockHeaderSlot(panelId: string): HTMLElement | null {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => revision)
  return slots.get(panelId) ?? null
}
