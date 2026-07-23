const path = require('node:path')
const { app, utilityProcess } = require('electron')

const PROTOCOL_VERSION = 'agent-utility/v1'

app.whenReady().then(() => {
  const entryPath = path.resolve(__dirname, '..', 'out', 'main', 'agent-utility.cjs')
  const child = utilityProcess.fork(entryPath, [], {
    serviceName: '痕迹AI智能助手运行时冒烟测试',
    stdio: 'pipe',
  })
  const timeout = setTimeout(() => {
    child.kill()
    console.error('Agent utility process 版本握手超时')
    app.exit(1)
  }, 10_000)

  child.on('message', (message) => {
    if (
      message?.type !== 'utility.ready'
      || message?.protocolVersion !== PROTOCOL_VERSION
    ) return
    clearTimeout(timeout)
    console.log(`Agent utility process 握手通过：${message.protocolVersion}`)
    child.kill()
    app.exit(0)
  })
  child.on('error', (type, location) => {
    clearTimeout(timeout)
    console.error(`Agent utility process 致命错误：${type} ${location}`)
    app.exit(1)
  })
})
