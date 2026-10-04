let measureContext: CanvasRenderingContext2D | null = null

function getMeasureContext(): CanvasRenderingContext2D | null {
  // 取不到上下文时不缓存失败结果，下次再试（环境就绪前的首次调用不应让之后的测量永久失效）
  if (!measureContext) {
    measureContext = document.createElement('canvas').getContext('2d')
  }
  return measureContext
}

/**
 * 使用目标控件的实际字体预先计算一组文案所需宽度。
 * `horizontalChromeWidth` 由调用方明确计入左右 padding、图标槽与边框，
 * 这样浮层在打开前就能得到最终宽度，不依赖打开后的 DOM 二次测量。
 */
export function measureElementTextWidth(
  target: HTMLElement,
  labels: readonly string[],
  horizontalChromeWidth: number,
): number | null {
  if (labels.length === 0) return null
  const context = getMeasureContext()
  if (!context) return null

  const style = window.getComputedStyle(target)
  context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`
  const textWidth = Math.max(...labels.map((label) => context.measureText(label).width))
  return Math.ceil(textWidth + horizontalChromeWidth)
}
