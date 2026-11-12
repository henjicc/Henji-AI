// 只读诊断：试一次渲染层日志桥的 flush 是否在 5 秒内返回
module.exports = async (page) => page.evaluate(async () => {
  const bridge = await import('/src/core/logging/bridge.ts')
  const cfg = await import('/src/core/logging/config.ts')
  const t = performance.now()
  const r = await Promise.race([bridge.flushFrontendLogBridge().then(() => 'resolved'), new Promise(res => setTimeout(() => res('timeout'), 5000))])
  return { r, ms: Math.round(performance.now() - t), config: cfg.getLogConfig() }
})
