// 直接连页面调试目标执行一条 CDP 命令（带超时），用于 Playwright 连不上时排查：node raw.cjs <方法> [JSON 参数]
;(async () => {
  const [method, params = '{}'] = process.argv.slice(2)
  const targets = await (await fetch('http://127.0.0.1:9334/json/list')).json()
  const page = targets.find(t => t.type === 'page')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const reply = new Promise(resolve => { socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id === 1) resolve(message) } })
  socket.send(JSON.stringify({ id: 1, method, params: JSON.parse(params) }))
  const result = await Promise.race([reply, new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 10000))])
  if (result.result?.data) { require('fs').writeFileSync(process.env.OUT || 'raw.jpg', Buffer.from(result.result.data, 'base64')); console.log('saved') }
  else console.log(JSON.stringify(result).slice(0, 2000))
  socket.close(); process.exit(0)
})().catch(error => { console.error(error); process.exit(1) })
