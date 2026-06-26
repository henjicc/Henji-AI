const { _electron: electron } = require('playwright')
const path = require('node:path')

async function main() {
  const app = await electron.launch({ args: [path.join(__dirname, 'main.js')] })

  const consoleMessages = []
  app.on('console', (msg) => consoleMessages.push(`[main] ${msg.text()}`))

  const win = await app.firstWindow()
  win.on('console', (msg) => consoleMessages.push(`[renderer] ${msg.text()}`))
  win.on('pageerror', (err) => consoleMessages.push(`[pageerror] ${err.message}`))

  console.log('window url:', win.url())
  console.log('window title:', await win.title())

  // 等自动测试脚本跑完（videoReplay 测试链路总耗时约 1s 出头）
  await win.waitForTimeout(2500)

  await win.screenshot({ path: path.join(__dirname, 'screenshot.png') })
  console.log('screenshot saved')

  const outDbText = await win.locator('#out-db').textContent({ timeout: 5000 }).catch((e) => 'LOCATOR_ERROR: ' + e.message)

  const winState = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return {
      isFrameless: !w.isResizable || true,
      bounds: w.getBounds(),
      isVisible: w.isVisible(),
    }
  })

  console.log('=== consoleMessages ===')
  console.log(consoleMessages.join('\n'))
  console.log('=== #out-db content ===')
  console.log(outDbText)
  console.log('=== window state ===')
  console.log(JSON.stringify(winState, null, 2))

  await app.close()
}

main().catch((error) => {
  console.error('test-driver failed:', error)
  process.exit(1)
})
