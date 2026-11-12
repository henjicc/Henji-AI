// 导入后每 2 秒截一张图，共 N 张，记录每张的时间
module.exports = async (page, b, { shot }) => {
  const n = Number(process.env.N || 10), out = []
  for (let i = 0; i < n; i++) {
    const t = new Date().toISOString()
    await shot(`r2-import-${String(i).padStart(2, '0')}.jpg`)
    const bad = await page.evaluate(() => { const t = document.body.innerText; return ['失败', '出错', '错误'].filter(k => t.includes(k)) })
    out.push({ i, t, bad })
    await page.waitForTimeout(2000)
  }
  return out
}
