// 在剪辑渲染 Worker 里设置一个全局诊断开关（对照实测用）：node workerflag.cjs <名字> <true|false>
// 直接连 Worker 的调试目标执行（Playwright 接管已有页面时列不出先前创建的 Worker）。
;(async () => {
  const [name, value] = process.argv.slice(2)
  const targets = await (await fetch('http://127.0.0.1:9334/json/list')).json()
  for (const target of targets.filter(t => t.type === 'worker' && t.url.includes('videoEditWorker'))) {
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    const reply = new Promise(resolve => { socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id === 1) resolve(message) } })
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `globalThis[${JSON.stringify(name)}] = ${value === 'true'}; String(globalThis[${JSON.stringify(name)}])`, returnByValue: true } }))
    console.log(target.id, JSON.stringify((await reply).result?.result?.value))
    socket.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
