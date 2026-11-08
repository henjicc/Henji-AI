/**
 * 查看器的起点：用户按下的那张缩略图。
 *
 * 打开查看器的入口散在生成结果、上传条、素材库、画布等十几处，逐处传坐标容易漏；
 * 这里在捕获阶段记下最近一次按在图片上的位置，查看器打开时取走，从那里放大出来，
 * 关闭时再按同一元素的当前位置缩回去（元素已卸载或滚出视口就退化为淡出）。
 */
export interface ViewerOrigin {
  element: HTMLImageElement
  src: string
  rect: DOMRect
}

/** 按下到查看器打开之间允许的间隔；更早的按下与这次打开无关。 */
const ORIGIN_MAX_AGE_MS = 1500

let latest: (ViewerOrigin & { at: number }) | null = null
let installed = false

function findImage(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof Element)) return null
  if (target instanceof HTMLImageElement) return target
  // 缩略图上常盖着编号、悬停按钮等兄弟元素，按到的不是图片本身。
  const card = target.closest('button, [role="button"], li, figure') ?? target
  const image = card.querySelector('img')
  return image && image.getBoundingClientRect().width > 0 ? image : null
}

function install(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    const element = findImage(event.target)
    latest = element && element.currentSrc
      ? { element, src: element.currentSrc, rect: element.getBoundingClientRect(), at: performance.now() }
      : null
  }, true)
}

install()

/** 取走这次打开对应的起点；只能取一次，避免下次打开沿用旧位置。 */
export function takeViewerOrigin(): ViewerOrigin | null {
  const origin = latest
  latest = null
  if (!origin || performance.now() - origin.at > ORIGIN_MAX_AGE_MS || !origin.element.isConnected) return null
  return { element: origin.element, src: origin.src, rect: origin.rect }
}

/** 关闭时起点元素若还在视口内，返回它的当前位置。 */
export function currentOriginRect(origin: ViewerOrigin): DOMRect | null {
  if (!origin.element.isConnected) return null
  const rect = origin.element.getBoundingClientRect()
  const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
    && rect.top < window.innerHeight && rect.left < window.innerWidth
  return visible ? rect : null
}
