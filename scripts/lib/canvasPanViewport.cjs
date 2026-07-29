'use strict'

function resolveAbsolutePosition(node, nodeById, cache, visiting) {
  const cached = cache.get(node.id)
  if (cached) return cached

  const local = { x: node.position?.x ?? 0, y: node.position?.y ?? 0 }
  if (!node.parentId || visiting.has(node.id)) {
    cache.set(node.id, local)
    return local
  }

  const parent = nodeById.get(node.parentId)
  if (!parent) {
    cache.set(node.id, local)
    return local
  }

  visiting.add(node.id)
  const parentPosition = resolveAbsolutePosition(parent, nodeById, cache, visiting)
  visiting.delete(node.id)
  const absolute = { x: local.x + parentPosition.x, y: local.y + parentPosition.y }
  cache.set(node.id, absolute)
  return absolute
}

function resolveNodeCenters(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const positionCache = new Map()

  return nodes
    .filter((node) => node.position)
    .map((node) => {
      const position = resolveAbsolutePosition(node, nodeById, positionCache, new Set())
      return {
        x: position.x + (node.width ?? node.measured?.width ?? 320) / 2,
        y: position.y + (node.height ?? node.measured?.height ?? 280) / 2,
      }
    })
}

function scoreSweepPath(centers, {
  startFlowX,
  centerY,
  flowWidth,
  flowHeight,
  sweepFlowDistance,
}) {
  const samples = 7
  const counts = []
  for (let index = 0; index < samples; index += 1) {
    const progress = index / (samples - 1)
    const left = startFlowX + sweepFlowDistance * progress
    const right = left + flowWidth
    const top = centerY - flowHeight * 0.48
    const bottom = centerY + flowHeight * 0.48
    counts.push(centers.filter((center) => (
      center.x >= left && center.x <= right && center.y >= top && center.y <= bottom
    )).length)
  }
  return {
    min: Math.min(...counts),
    average: counts.reduce((sum, count) => sum + count, 0) / counts.length,
    start: counts[0],
  }
}

function isBetterScore(next, current) {
  if (!current) return true
  if (next.min !== current.min) return next.min > current.min
  if (next.average !== current.average) return next.average > current.average
  return next.start > current.start
}

/**
 * 规划扫掠起点：把父子节点坐标统一成绝对坐标，并最大化整段路径上的最低节点密度。
 * 不能只取最左端或只统计顶层节点，否则会把真实复杂节点留在路径外，测成空画布上限。
 */
function planSweepViewport(nodes, { innerWidth, innerHeight, zoom, sweepScreenDistance }) {
  const flowWidth = innerWidth / zoom
  const flowHeight = innerHeight / zoom
  const sweepFlowDistance = sweepScreenDistance / zoom
  const centers = resolveNodeCenters(nodes)
  if (!centers.length) return { x: 0, y: 0, zoom }

  const xCandidates = new Set()
  for (const center of centers) {
    for (const anchor of [0.12, 0.5, 0.88]) {
      xCandidates.add(center.x - flowWidth * anchor)
      xCandidates.add(center.x - sweepFlowDistance - flowWidth * anchor)
    }
  }

  let best = null
  for (const centerY of new Set(centers.map((center) => center.y))) {
    for (const startFlowX of xCandidates) {
      const score = scoreSweepPath(centers, {
        startFlowX,
        centerY,
        flowWidth,
        flowHeight,
        sweepFlowDistance,
      })
      if (isBetterScore(score, best?.score)) best = { startFlowX, centerY, score }
    }
  }

  const graphMaxX = Math.max(...centers.map((center) => center.x))
  const availableFlowDistance = Math.max(
    0,
    (graphMaxX + flowWidth * 0.12) - (best.startFlowX + flowWidth),
  )

  return {
    x: -best.startFlowX * zoom,
    y: innerHeight / 2 - best.centerY * zoom,
    zoom,
    bandNodeCount: centers.filter((center) => (
      Math.abs(center.y - best.centerY) <= flowHeight * 0.48
    )).length,
    pathMinVisibleNodeCount: best.score.min,
    pathAverageVisibleNodeCount: Number(best.score.average.toFixed(1)),
    requestedSweepFlowDistance: sweepFlowDistance,
    availableSweepFlowDistance: Number(availableFlowDistance.toFixed(1)),
    availableSweepScreenDistance: Number((availableFlowDistance * zoom).toFixed(1)),
  }
}

module.exports = { planSweepViewport, resolveNodeCenters, scoreSweepPath }
