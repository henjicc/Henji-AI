const assert = require('node:assert/strict')

function createNetworkScenes() {
  return [{ id: 'network-transport-probe', surface: '诊断', name: '网络传输只读对比', writesUserData: false,
    async setup(_page, electronApp) {
      const remote = process.env.HENJI_NETWORK_PROBE_REMOTE === '1'
      const result = await electronApp.evaluate(async ({ net, session }, remoteEnabled) => {
        const http = process.getBuiltinModule('node:http')
        const server = http.createServer((_request, response) => { response.end('probe-ok') })
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        const localUrl = `http://127.0.0.1:${address.port}/probe`
        const targets = [localUrl, ...(remoteEnabled ? ['https://api.kie.ai/api/v1/jobs/recordInfo'] : [])]
        const records = []
        try {
          for (const url of targets) {
            const proxy = await session.defaultSession.resolveProxy(url)
            for (const [name, send] of [['node', fetch], ['chromium', net.fetch]]) {
              const started = Date.now()
              try {
                const response = await send(url, { method: 'GET', signal: AbortSignal.timeout(8000) })
                await response.body?.cancel()
                records.push({ target: url === localUrl ? 'local' : 'kie', transport: name, status: response.status,
                  proxyMode: proxy === 'DIRECT' ? 'direct' : 'configured', durationMs: Date.now() - started })
              } catch (error) {
                records.push({ target: url === localUrl ? 'local' : 'kie', transport: name,
                  code: error.cause?.code ?? error.code ?? error.name, durationMs: Date.now() - started })
              }
            }
          }
        } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
        return records
      }, remote)
      console.log('[network-probe]', JSON.stringify(result))
      for (const record of result.filter(record => record.target === 'local')) assert.equal(record.status, 200)
      // 外网当前不可达也是诊断结果，不能解释成生成接口成功。
      if (remote) assert.equal(result.filter(record => record.target === 'kie').length, 2)
    },
  }]
}
module.exports = { createNetworkScenes }
