// 读渲染层内存里的日志（Vite 开发版按同一 URL 拿到同一模块实例）；RE 事件名正则，SINCE ISO 起点
module.exports = async (page) => page.evaluate(async ({ re, since }) => {
  const store = await import('/src/core/logging/store.ts')
  const rx = new RegExp(re)
  const all = store.getLogEvents()
  const rows = all.filter(e => rx.test(e.event) && String(e.timestamp) >= since)
  return { total: all.length, last: all.length ? [all[all.length - 1].timestamp, all[all.length - 1].event] : null, rows: rows.map(e => ({ t: String(e.timestamp).slice(11, 23), l: e.level, e: e.event, c: e.context })) }
}, { re: process.env.RE || '.', since: process.env.SINCE || '' })
