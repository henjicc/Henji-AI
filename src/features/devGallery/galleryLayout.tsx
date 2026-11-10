/**
 * 组件样张页的排版小件（任务 5.11，只供开发样张页）：分区、状态矩阵、强制状态包装。
 * 只做排布，不画任何组件外观——外观全部来自被展示的 `@/components/ui` 组件本身。
 */
import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react'

import { UiGroup, UI_TEXT_META_CLASS } from '@/components/ui'

import { GALLERY_FORCED_STATE_CLASS, type GalleryForcedState } from './forcedPseudoStates'

const INTERACTIVE_SELECTOR = 'button, input, textarea, select, [role="option"], [role="switch"], [role="checkbox"], [tabindex]'

/**
 * 给子组件挂强制悬停/聚焦类（见 forcedPseudoStates）：挂在组件根元素上，根元素不可交互时再挂到其中第一个可交互元素。
 * `display: contents` 包装，不改变布局。
 */
export function GalleryForce({ state, children }: { state?: GalleryForcedState; children: ReactElement }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const root = ref.current?.firstElementChild
    if (!state || !root) return undefined
    const cls = GALLERY_FORCED_STATE_CLASS[state]
    const targets = [root, root.matches(INTERACTIVE_SELECTOR) ? null : root.querySelector(INTERACTIVE_SELECTOR)]
      .filter((element): element is Element => element !== null)
    targets.forEach((element) => element.classList.add(cls))
    return () => targets.forEach((element) => element.classList.remove(cls))
  }, [state])
  return <span ref={ref} className="contents" data-gallery-state={state}>{children}</span>
}

export function GallerySection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <UiGroup title={title} titleTone="compact" data-gallery-section={title}>
      <div className="flex flex-col gap-2">{children}</div>
    </UiGroup>
  )
}

/** 一行：左侧状态名 + 若干样本。 */
export function GalleryRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={`w-12 shrink-0 ${UI_TEXT_META_CLASS}`}>{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

