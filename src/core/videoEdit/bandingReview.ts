export interface VideoEditBandingEvidence {
  region: { x: number; y: number; width: number; height: number }
  axis: 'horizontal' | 'vertical'
  levels: number
}
interface Run { start: number; end: number; level: number; color: number }
interface Patch { start: number; end: number; first: number; last: number; levels: number; lines: number }
const minimumAreaRatio = .001

/** 原尺寸扫描宽平台与连续一级台阶；不平滑像素，避免把有效抖动重新变成色带。 */
export function detectVideoEditBanding(pixels: Uint8ClampedArray, width: number, height: number): VideoEditBandingEvidence[] {
  if (pixels.length !== width * height * 4) throw new Error(`色带检查的画面尺寸不一致：${width}×${height} 需要 ${width * height * 4} 个通道值，实际 ${pixels.length} 个。`)
  const result: VideoEditBandingEvidence[] = []
  for (const axis of ['horizontal', 'vertical'] as const) for (const channel of [0, 1, 2]) {
    const length = axis === 'horizontal' ? width : height, cross = axis === 'horizontal' ? height : width
    const minimumRun = Math.max(5, Math.ceil(length / 160)), stride = Math.max(1, Math.floor(cross / 96))
    let active: Patch[] = []
    const finish = (patch: Patch): void => {
      const thickness = patch.last - patch.first + 1
      if (patch.lines < 3 || thickness < cross * .025 || (patch.end - patch.start) * thickness < width * height * minimumAreaRatio) return
      const region = axis === 'horizontal'
        ? { x: patch.start / width, y: patch.first / height, width: (patch.end - patch.start) / width, height: thickness / height }
        : { x: patch.first / width, y: patch.start / height, width: thickness / width, height: (patch.end - patch.start) / height }
      // 两个方向可能看到同一片台阶，保留第一次可定位的证据。
      if (!result.some(value => Math.min(region.x + region.width, value.region.x + value.region.width) > Math.max(region.x, value.region.x)
        && Math.min(region.y + region.height, value.region.y + value.region.height) > Math.max(region.y, value.region.y))) result.push({ region, axis, levels: patch.levels })
    }
    for (let line = 0; line < cross; line += stride) {
      const runs: Run[] = []
      for (let at = 0; at < length; at++) {
        const index = (axis === 'horizontal' ? line * width + at : at * width + line) * 4
        // 与导出一致先合成到黑底；按各通道找台阶，避免亮度加权吞掉蓝色平台。
        const alpha = pixels[index + 3] / 255
        const rgb = [0, 1, 2].map(offset => Math.round(pixels[index + offset] * alpha))
        const color = rgb[0] * 65536 + rgb[1] * 256 + rgb[2]
        const level = rgb[channel], previous = runs.at(-1)
        if (previous?.level === level) {
          previous.end = at + 1
          if ([65536, 256, 1].some(divisor => Math.abs(Math.floor(color / divisor) % 256 - Math.floor(previous.color / divisor) % 256) > 2)) previous.color = -1
        } else runs.push({ start: at, end: at + 1, color, level })
      }
      const spans: Array<{ start: number; end: number; levels: number }> = []
      let first = 0, direction = 0
      for (let i = 0; i <= runs.length; i++) {
        const run = runs[i], previous = runs[i - 1]
        const delta = run && previous ? run.level - previous.level : 0
        const valid = run && run.color >= 0 && run.end - run.start >= minimumRun
        const adjacent = valid && previous && previous.color >= 0 && previous.end - previous.start >= minimumRun && Math.abs(delta) === 1
          && [65536, 256, 1].every(divisor => Math.abs(Math.floor(run.color / divisor) % 256 - Math.floor(previous.color / divisor) % 256) <= 2)
        if (adjacent && (!direction || direction === delta)) { direction = delta; continue }
        if (i - first >= 2 && direction) {
          // 台阶两端的平台可能是延伸到画面边缘的大片底色，只保留与台阶等宽的一段，区域才指向断层本身。
          const inner = runs.slice(first + 1, i - 1).map(value => value.end - value.start)
          const reach = inner.length ? Math.max(...inner) : Math.min(runs[first].end - runs[first].start, previous.end - previous.start)
          spans.push({ start: Math.max(runs[first].start, runs[first].end - reach), end: Math.min(previous.end, previous.start + reach), levels: i - first })
        }
        first = adjacent ? i - 1 : i; direction = adjacent ? delta : 0
      }
      const next: Patch[] = []
      for (const span of spans) {
        const match = active.find(patch => Math.min(patch.end, span.end) - Math.max(patch.start, span.start) >= minimumRun * 2)
        if (match) { active = active.filter(patch => patch !== match); next.push({ start: Math.min(match.start, span.start), end: Math.max(match.end, span.end), first: match.first, last: line, levels: Math.max(match.levels, span.levels), lines: match.lines + 1 }) }
        else next.push({ ...span, first: line, last: line, lines: 1 })
      }
      active.forEach(finish); active = next
    }
    active.forEach(finish)
  }
  return result
}
