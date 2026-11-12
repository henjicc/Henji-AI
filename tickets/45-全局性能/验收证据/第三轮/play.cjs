// 播放 10 秒后暂停（节目监视器播放按钮），播放前后各采一次原生解码流计数，中途截一张图。结果写 <TAG>-play.json。
// 用法：node play.cjs；环境变量：TAG 截图与结果前缀，PX/PY 播放按钮 CSS 坐标，SEEK=1 先把播放头放回开头（点 SX/SY），
// MULTICAM=1 先从节目监视器“…”菜单打开多机位视图（菜单按钮 MX/MY）。t0/t1 是日志口径（UTC）。
const fs = require('fs')
const path = require('path')
const { connect, wait } = require('./rawcdp.cjs')
;(async () => {
  const tag = process.env.TAG || 'x'
  const px = Number(process.env.PX || 1108), py = Number(process.env.PY || 900)
  const page = await connect()
  const out = file => path.join(__dirname, file)
  try {
    await page.evaluate(`[...document.querySelectorAll('button')].filter(b => b.innerText.trim() === '接管').forEach(b => b.click()); true`)
    await wait(500)
    const tc = () => page.evaluate(`document.body.innerText.match(/\\d\\d:\\d\\d:\\d\\d:\\d\\d NDF/)?.[0] ?? null`)
    const streams = () => page.evaluate(`(async () => {
      const s = await window.henjiNative.videoFrames.stats()
      return (s.native?.streams || []).filter(x => x.kind === 'decoder').map(x => ({ id: x.streamId, w: x.width, ...Object.fromEntries(['produced', 'decoded', 'held', 'missing', 'released', 'outstanding', 'waitUsTotal', 'decodeUsTotal', 'paces', 'paceUsTotal', 'settles', 'settleUsTotal'].map(k => [k, x.counters?.[k]])) }))
    })()`)
    if (process.env.MULTICAM) {
      await page.click(Number(process.env.MX || 1416), Number(process.env.MY || 900)); await wait(700)
      const opened = await page.evaluate(`(() => { const item = [...document.querySelectorAll('[role="menuitem"],button,div')].find(e => e.innerText?.trim() === '多机位视图（1–9 切换）'); if (!item) return false; item.click(); return true })()`)
      if (!opened) throw new Error('没找到多机位视图菜单项')
      await wait(6000)
      await page.shot(out(`${tag}-open.jpg`))
    }
    if (process.env.SEEK) { await page.click(Number(process.env.SX || 418), Number(process.env.SY || 851)); await wait(2500) }
    const tcStart = await tc()
    const before = await streams()
    const t0 = new Date().toISOString()
    const started = Date.now()
    await page.click(px, py)
    // SAMPLE=1：每 250ms 记一次各流的沿用数与交出未还的帧数（看跳帧发生在什么时候）。
    const samples = []
    const sample = async () => { const now = await streams(); samples.push({ ms: Date.now() - started, streams: now.map(s => `${s.id}:held${s.held}/out${s.outstanding}/prod${s.produced}`).join(' ') }) }
    const until = async (ms) => { while (Date.now() - started < ms) { if (process.env.SAMPLE) await sample(); await wait(process.env.SAMPLE ? Number(process.env.SAMPLE) : ms - (Date.now() - started)) } }
    await until(5000)
    await page.shot(out(`${tag}-play.jpg`))
    await until(9900)
    const after = await streams()
    await page.click(px, py)
    const t1 = new Date().toISOString()
    await wait(1000)
    const tcEnd = await tc()
    const bad = await page.evaluate(`['过多', '无法显示', '失败', '出错', '错误'].filter(k => document.body.innerText.includes(k))`)
    const delta = after.map(a => { const p = before.find(x => x.id === a.id) || {}; return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'number' && k !== 'w' && k !== 'outstanding' ? Math.round((v - (p[k] || 0)) * 100) / 100 : v])) }).filter(x => x.produced > 0 || x.held > 0)
    const result = { t0, t1, tcStart, tcEnd, bad, delta, samples }
    fs.writeFileSync(out(`${tag}-play.json`), JSON.stringify(result, null, 1))
    console.log(t0, t1, tcStart, tcEnd, JSON.stringify(bad))
    for (const d of delta) console.log(d.id, `${d.w}w`, 'produced', d.produced, 'held', d.held, 'decoded', d.decoded, 'waitS', (d.waitUsTotal / 1e6).toFixed(2), 'paceS', (d.paceUsTotal / 1e6).toFixed(2), 'out', d.outstanding)
  } finally { page.close() }
  process.exit(0)
})().catch(error => { console.error(error); process.exit(1) })
