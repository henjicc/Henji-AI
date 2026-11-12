// 直接连调试端口（9334）的页面目标：点击、执行表达式、截图。Playwright 接管已有窗口时偶尔卡在连接阶段，这里只用原始 CDP。
const fs = require('fs')
async function connect() {
  const targets = await (await fetch('http://127.0.0.1:9334/json/list')).json()
  const page = targets.find(t => t.type === 'page')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let next = 0
  const pending = new Map()
  socket.onmessage = event => { const message = JSON.parse(event.data); const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); waiter(message) } }
  const send = (method, params = {}, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const id = ++next
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)) }, timeoutMs)
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result) })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return {
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 300))
      return result.result.value
    },
    async click(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    },
    async shot(file) {
      const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
    },
    close() { socket.close() },
  }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
module.exports = { connect, wait }
