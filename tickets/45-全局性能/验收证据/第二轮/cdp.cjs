// 用法: node cdp.cjs <脚本文件>；脚本导出 async (page, browser, helpers) => any
const path = require('path')
const { chromium } = require('D:/VibeCode/Henji-AI/node_modules/playwright-core')
;(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9334')
  const page = browser.contexts()[0].pages().find(p => p.url().includes('localhost:517'))
  const shot = async (name) => { const c = await page.context().newCDPSession(page); const r = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); require('fs').writeFileSync(path.join(__dirname, name), Buffer.from(r.data, 'base64')); await c.detach() }
  try {
    const out = await require(path.resolve(process.argv[2]))(page, browser, { shot })
    if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1))
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exit(1) })
