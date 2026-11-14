'use strict'

/** 把画布大规模基准的一行结果压成几行可读文字（给终端与任务记录用）。 */
function formatScaleResult(result) {
  const lines = [`${result.count} 节点 / ${result.edges} 连线：打开到首帧 ${result.firstPaintMs}ms；外框 ${result.mounted.domNodes}，正文 ${result.mounted.bodies}，元素 ${result.mounted.elements}`]
  for (const [key, label] of [['idleFar', '远景静止'], ['panFar', '远景平移'], ['dragFar', '远景拖节点'], ['panNear', '近景平移'], ['zoomFast', '快速缩放']]) {
    const phase = result[key]
    if (!phase) continue
    lines.push(`  ${label}：${phase.fps}fps，p95 ${phase.p95}ms，最长 ${phase.max}ms，超 50ms 的帧 ${phase.over50}，长任务 ${phase.longFrames} 次（最长 ${phase.longFrameMaxMs}ms），主线程 ${phase.mainThread.TaskMs}/${phase.elapsedMs}ms（脚本 ${phase.mainThread.ScriptMs}）`)
  }
  if (result.nearBodies !== undefined) lines.push(`  近景缩放 ${Number(result.nearZoom).toFixed(2)} 时挂载正文 ${result.nearBodies}`)
  if (result.captureMs != null) lines.push(`  截一次画布区域：${result.captureMs}ms`)
  if (result.memoryAfterOpen) lines.push(`  打开后内存：渲染 ${result.memoryAfterOpen.rendererPrivateMB}MB，GPU ${result.memoryAfterOpen.gpuPrivateMB}MB`)
  lines.push(`  全部阶段后内存：渲染 ${result.memory.rendererPrivateMB}MB，GPU ${result.memory.gpuPrivateMB}MB，脚本堆 ${result.jsHeapMB}MB`)
  return lines.join('\n')
}

module.exports = { formatScaleResult }
