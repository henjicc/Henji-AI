function missingScrollCoverage(captures) {
  const regions = new Map()
  for (const capture of captures) for (const region of capture) {
    const key = `${region.element}|${region.id}`
    const current = regions.get(key) || { element: region.element, id: region.id, height: 0, ranges: [] }
    current.height = Math.max(current.height, region.scrollHeight)
    const start = region.scrollTop + (region.visibleOffset || 0)
    current.ranges.push([start, start + Math.min(region.clientHeight, region.visibleHeight)])
    regions.set(key, current)
  }
  const missing = []
  for (const region of regions.values()) {
    let end = 0
    const gaps = []
    for (const [start, stop] of region.ranges.sort((a, b) => a[0] - b[0])) {
      if (start > end + 1) gaps.push([end, start])
      end = Math.max(end, stop)
    }
    if (end < region.height - 1) gaps.push([end, region.height])
    if (gaps.length) missing.push({ element: region.element, id: region.id, gaps })
  }
  return missing
}
module.exports = { missingScrollCoverage }
