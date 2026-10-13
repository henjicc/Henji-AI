const EDITING = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])'

/**
 * 把键盘焦点移进某个剪辑面板，后续快捷键（空格播放等）按该面板的作用域生效。
 * 面板刚激活、刚打开项目或刚换序列时，目标元素要过几帧才提交到 DOM；新建序列对话框这类模态框还在收起时也要等它关掉。
 * 逐帧重试直到可以聚焦，最多约两秒。用户正在输入文字时不抢焦点。
 */
export function focusVideoEditPanelElement(panel: string): void {
  let attempts = 0
  const tryFocus = (): void => {
    if (document.activeElement?.closest(EDITING) && !document.activeElement.closest('[role="dialog"]')) return
    const modalOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))
    const element = document.querySelector<HTMLElement>(`[data-video-edit-panel="${panel}"]`)
    const target = element?.querySelector<HTMLElement>('[data-video-edit-timeline-viewport],[tabindex="0"]')
    if (modalOpen || !element || (!target && panel === 'timeline')) {
      if (++attempts < 120) requestAnimationFrame(tryFocus)
      return
    }
    const focusTarget = target ?? element
    if (focusTarget === element && !element.hasAttribute('tabindex')) element.tabIndex = -1
    focusTarget.focus({ preventScroll: true })
  }
  requestAnimationFrame(tryFocus)
}
