import { createLogger } from '@/core/logging'
import { auditLayoutIssues, type LayoutAuditIssue } from './layoutAudit'

/**
 * 运行时布局守卫（重要记录 020）：界面安静下来后跑一遍遮挡与裁切检查（与巡检同一份实现），
 * 新出现的问题记一条结构化日志（`ui.layout_issue.detected`，用 `npm run logs:query` 查），
 * `outline` 模式再给出问题的元素描一圈危险色边框。
 *
 * - 开发运行（electron:dev）默认 `outline`；本机正式构建（electron:prod）与安装包一致默认不运行，需要时显式传 `--dev-layout-guard=log` 只记日志；
 *   安装包不带参数，不运行。
 * - 不在拖动、按住鼠标、指针移动中或窗口不可见时检查；定时补查只在界面变过之后才跑；同一问题每次运行只记一次，日志总数有上限。
 */
export type LayoutGuardMode = 'outline' | 'log'

const logger = createLogger('app.ui.layoutGuard')
const SETTLE_MS = 700
const PERIOD_MS = 4000
const MAX_LOGGED = 120
const RULE_LABELS: Record<LayoutAuditIssue['rule'], string> = { controlClipped: '裁切', controlOccluded: '遮挡' }

export function startLayoutGuard(mode: LayoutGuardMode, target: Window = window): () => void {
  const document = target.document
  const logged = new Set<string>()
  let suppressed = false
  let pressed = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let idle: { cancel: () => void } | undefined
  let layer: HTMLDivElement | null = null

  const draw = (targets: NonNullable<ReturnType<typeof auditLayoutIssues>['targets']>): void => {
    if (mode !== 'outline') return
    if (!targets.length) { layer?.remove(); layer = null; return }
    if (!layer) {
      layer = document.createElement('div')
      layer.setAttribute('data-layout-guard-layer', '')
      layer.setAttribute('aria-hidden', 'true')
      layer.className = 'pointer-events-none fixed inset-0 z-titlebar'
    }
    if (!layer.isConnected) document.body.append(layer)
    layer.replaceChildren(...targets.map(({ issue }) => {
      const [left, top, right, bottom] = issue.bounds
      const box = document.createElement('div')
      box.className = 'absolute rounded-hairline ring-2 ring-danger-text'
      Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(2, right - left)}px`, height: `${Math.max(2, bottom - top)}px` })
      const tag = document.createElement('span')
      tag.className = 'absolute -top-4 left-0 whitespace-nowrap rounded-hairline bg-danger-solid px-1 text-2xs leading-4 text-on-danger'
      tag.textContent = RULE_LABELS[issue.rule]
      box.append(tag)
      return box
    }))
  }
  const run = (): void => {
    idle = undefined
    if (document.hidden || pressed > 0) { schedule(); return }
    changed = false
    let result: ReturnType<typeof auditLayoutIssues>
    try { result = auditLayoutIssues({ collectElements: true }) } catch (error) { logger.warn('布局守卫检查失败', { event: 'ui.layout_guard.failed', error }); return }
    const targets = result.targets ?? []
    draw(targets)
    for (const { issue } of targets) {
      const key = `${issue.rule}|${issue.surface}|${issue.element}|${issue.by}`
      if (logged.has(key)) continue
      if (logged.size >= MAX_LOGGED) {
        if (!suppressed) { suppressed = true; logger.warn('布局问题过多，本次运行不再逐条记录', { event: 'ui.layout_issue.suppressed', limit: MAX_LOGGED }) }
        break
      }
      logged.add(key)
      logger.warn(`界面${RULE_LABELS[issue.rule]}：${issue.element}`, { event: 'ui.layout_issue.detected', rule: issue.rule, element: issue.element, by: issue.by, detail: issue.detail, surface: issue.surface, bounds: issue.bounds, window: `${target.innerWidth}x${target.innerHeight}` })
    }
  }
  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (idle !== undefined) return
      if (typeof target.requestIdleCallback === 'function') { const handle = target.requestIdleCallback(run, { timeout: 1500 }); idle = { cancel: () => target.cancelIdleCallback(handle) } }
      else { const handle = target.setTimeout(run, 0); idle = { cancel: () => target.clearTimeout(handle) } }
    }, SETTLE_MS)
  }
  const down = (): void => { pressed += 1 }
  const up = (): void => { pressed = Math.max(0, pressed - 1); schedule() }
  // 检查是整页同步扫描，跑在鼠标移动中间会让跟手的东西（悬停竖线、拖动预览）卡一下：
  // 指针移动只推迟检查（停稳 SETTLE_MS 后才跑）；定时补查只在界面结构或状态真的变过时才跑，静止的界面不反复扫。
  let changed = true
  const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(records => {
    // 守卫自己描的边框不算界面变化，否则 outline 模式会一直自己触发自己
    const own = (node: Node): boolean => node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute('data-layout-guard-layer')
    const ownRecord = (record: MutationRecord): boolean => (layer?.contains(record.target) ?? false)
      || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(own) && record.addedNodes.length + record.removedNodes.length > 0)
    if (records.some(record => !ownRecord(record))) changed = true
  })
  mutations?.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'aria-hidden', 'aria-expanded', 'data-state'] })
  const idleSchedule = (): void => { if (changed) schedule() }
  const events: Array<[string, EventListener]> = [['resize', schedule], ['pointerdown', down], ['pointerup', up], ['pointercancel', up], ['keyup', schedule], ['wheel', schedule]]
  for (const [name, listener] of events) target.addEventListener(name, listener, { passive: true, capture: true })
  const moved = (): void => {
    if (timer === undefined && idle === undefined) return
    idle?.cancel(); idle = undefined
    schedule()
  }
  target.addEventListener('pointermove', moved, { passive: true, capture: true })
  const interval = target.setInterval(idleSchedule, PERIOD_MS)
  schedule()
  return () => {
    for (const [name, listener] of events) target.removeEventListener(name, listener, { capture: true })
    target.removeEventListener('pointermove', moved, { capture: true })
    mutations?.disconnect()
    target.clearInterval(interval)
    if (timer !== undefined) clearTimeout(timer)
    idle?.cancel()
    layer?.remove()
  }
}
