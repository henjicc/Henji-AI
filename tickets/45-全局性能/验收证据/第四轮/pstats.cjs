// 用法: node pstats.cjs <since UTC ISO（日志口径）> [until]
// 打印这段时间的节目/多机位播放统计、掉帧段与关闭的原生流计数。日志文件按 since 的 UTC 日期取。
const fs = require('fs')
const [since, until0] = process.argv.slice(2)
const until = until0 || '9999'
const file = `E:/文档/HenjiAI/.system/logs/henji-${since.slice(0, 10)}.log`
const pick = (h) => h && `${h.p50}/${h.p95}/${h.max}`
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line) continue
  let j; try { j = JSON.parse(line) } catch { continue }
  if (j.timestamp < since || j.timestamp > until) continue
  const c = j.context || {}
  if (j.event === 'video_edit.playback.stats' || j.event === 'video_edit.multicam.playback.stats') {
    const fps = c.durationMs ? Math.round(c.presentedFrames / c.durationMs * 1e5) / 100 : null
    console.log(j.timestamp.slice(11, 23), j.event, JSON.stringify({ reason: c.reason, start: c.startFrame, expected: c.expectedFrames, presented: c.presentedFrames, dropped: c.droppedFrames, ratio: c.droppedRatio, maxRun: c.maxConsecutiveDropped, approx: c.approximateFrames, cached: c.cachedFrames, ms: c.durationMs, fps, actualFps: c.actualFps, proxies: c.proxies, render: pick(c.renderMs), latency: pick(c.presentLatencyMs) }))
    console.log('   stages', JSON.stringify(Object.fromEntries(Object.entries(c.stages || {}).filter(([, v]) => v.max > 0.5).map(([k, v]) => [k, pick(v)]))))
  } else if (j.event === 'video_edit.render_cache.dropped') {
    console.log(j.timestamp.slice(11, 23), 'dropped', JSON.stringify({ range: `${c.startFrame}-${c.endFrame}`, dropped: c.droppedFrames, samples: c.sampleFrames, p90: c.p90Ms, slowest: c.slowestStage, stages: Object.fromEntries(Object.entries(c.stages || {}).filter(([, v]) => v > 1).map(([k, v]) => [k, Math.round(v)])) }))
  } else if (j.event === 'video_frames.stream.closed' && (c.delivered > 60 || c.native?.held > 0)) {
    const n = c.native || {}
    console.log(j.timestamp.slice(11, 23), 'closed', c.streamId, `${c.width}x${c.height}`, JSON.stringify({ delivered: c.delivered, decoded: n.decoded, held: n.held, waitS: Math.round(n.waitUsTotal / 1e4) / 100, decodeS: Math.round(n.decodeUsTotal / 1e4) / 100, paces: n.paces, paceS: Math.round((n.paceUsTotal || 0) / 1e4) / 100, release: pick(c.releaseMs) }))
  } else if (/multicam\.preview\.(start|first_frame)|play_start/.test(j.event)) {
    console.log(j.timestamp.slice(11, 23), j.event, JSON.stringify(c).slice(0, 300))
  }
}
