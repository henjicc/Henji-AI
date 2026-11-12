// 自动预渲染开始与让出：保持页面“有焦点”（开发版最小化在后台），每 250 ms 采样显卡；编码器一开始工作（自动预渲染开始），
// 3 秒后发一次 Shift 按键模拟用户输入，再看 4 秒编码器是否归零。显卡重负载控制在 10 秒内。
// 用法：node autoyield.cjs <最长等待秒数> <输出 csv>
const fs = require('fs')
const { execFileSync } = require('child_process')
const { connect, wait } = require('../第四轮/rawcdp.cjs')
const sample = () => {
  const line = execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu,utilization.decoder,utilization.encoder', '--format=csv,noheader,nounits']).toString().trim()
  const [gpu, dec, enc] = line.split(',').map(value => Number(value.trim()))
  return { at: new Date().toISOString(), gpu, dec, enc }
}
;(async () => {
  const page = await connect()
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const rows = []
  const deadline = Date.now() + Number(process.argv[2] || 70) * 1000
  let startedAt
  while (Date.now() < deadline) {
    const row = sample(); rows.push(row)
    if (!startedAt && row.enc > 0) { startedAt = Date.now(); console.log('encoder started', row.at) }
    if (startedAt && Date.now() - startedAt >= 3000) break
    await wait(250)
  }
  if (startedAt) {
    const inputAt = new Date().toISOString()
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 })
    console.log('input', inputAt)
    for (let index = 0; index < 16; index++) { rows.push({ ...sample(), afterInput: true }); await wait(250) }
  }
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  fs.writeFileSync(process.argv[3], ['at,gpu,dec,enc,afterInput', ...rows.map(row => `${row.at},${row.gpu},${row.dec},${row.enc},${row.afterInput ? 1 : 0}`)].join('\n'))
  console.log('rows', rows.length, 'started', Boolean(startedAt))
  page.close(); process.exit(0)
})().catch(error => { console.error(error); process.exit(1) })
