const assert = require('node:assert/strict')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')

function createMcpScenes({ setupSettings, canvasFixtureProjectId }) {
  const waitReady = async (page) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (await page.evaluate(async () => (await window.henjiNative.mcp.status()).ready)) return
      await page.waitForTimeout(100)
    }
    throw new Error('应用宿主未在限定时间内就绪')
  }
  return [{ id: 'mcp-read-lifecycle', surface: '设置', name: '外部连接-只读与重载', writesUserData: true,
    setup: async (page) => {
      await page.evaluate(() => window.henjiNative.assetLibrary.createLibrary('MCP隔离验收素材库'))
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      const initial = await page.evaluate(() => window.henjiNative.mcp.status())
      assert.equal(initial.enabled, false)
      const section = page.locator('#general-mcp')
      await section.getByRole('switch').click()
      await section.getByPlaceholder('例如：Codex').fill('协议验收客户端')
      await section.getByRole('button', { name: '授权读取' }).click()
      await section.getByRole('button', { name: '复制连接配置' }).waitFor()
      await waitReady(page)
      const connection = await page.evaluate(async () => {
        const status = await window.henjiNative.mcp.status()
        const identity = status.connections.find((item) => item.name === '协议验收客户端')
        return { id: identity.id, config: JSON.parse(await window.henjiNative.mcp.connectionConfig({ id: identity.id })).mcpServers.henji }
      })
      const connect = async () => {
        const client = new Client({ name: 'Henji Reality', version: '1' })
        await client.connect(new StreamableHTTPClientTransport(new URL(connection.config.url), { requestInit: { headers: connection.config.headers } }))
        return client
      }
      let client = await connect()
      try {
        assert.equal((await client.listTools()).tools.length, 3)
        const described = await client.callTool({ name: 'describe_application_entities', arguments: { entityTypes: ['settings.registry', 'asset.library', 'canvas.project', 'generation.model'] } })
        assert.equal(described.isError, false, JSON.stringify(described))
        for (const entityType of ['settings.registry', 'asset.library', 'canvas.project', 'generation.model']) {
          console.log(`[MCP Reality] 读取 ${entityType}`)
          const listed = await client.callTool({ name: 'list_application_entities', arguments: { entityType, limit: 5 } })
          assert.equal(listed.isError, false, JSON.stringify(listed))
          const refs = listed.structuredContent.data.refs
          assert.ok(refs.length > 0, `${entityType} 必须存在真实实例`)
          const ref = entityType === 'canvas.project' ? refs.find((item) => item.id === canvasFixtureProjectId) : refs[0]
          assert.ok(ref, `${entityType} 夹具引用存在`)
          const propertyIds = described.structuredContent.data.properties.filter((property) => property.entityType === entityType).slice(0, 3).map((property) => property.id)
          assert.ok(propertyIds.length > 0, `${entityType} 必须有授权可读字段`)
          const read = await client.callTool({ name: 'read_application_entity', arguments: { ref, propertyIds } })
          assert.equal(read.isError, false, JSON.stringify(read))
          assert.ok(Object.keys(read.structuredContent.data.properties).length > 0, `${entityType} 必须读回字段值`)
        }
        await page.reload()
        console.log('[MCP Reality] 等待重载宿主')
        await waitReady(page)
        assert.equal((await client.listTools()).tools.length, 3)
        const after = await client.callTool({ name: 'read_application_entity', arguments: { ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_tone'] } })
        assert.equal(after.isError, false)
        await client.close()
        console.log('[MCP Reality] 同页面关闭再开启')
        await page.evaluate(async () => { const state = await window.henjiNative.mcp.status(); await window.henjiNative.mcp.configure({ enabled: false, port: state.port }); await window.henjiNative.mcp.configure({ enabled: true, port: state.port }) })
        client = await connect()
        assert.equal((await client.listTools()).tools.length, 3)
        await page.evaluate((id) => window.henjiNative.mcp.revoke({ id }), connection.id)
        const denied = await fetch(connection.config.url, { headers: connection.config.headers })
        assert.equal(denied.status, 401)
      } finally {
        await client.close()
        await page.evaluate(async () => { const state = await window.henjiNative.mcp.status(); await window.henjiNative.mcp.configure({ enabled: false, port: state.port }) })
      }
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      await page.locator('#general-mcp').scrollIntoViewIfNeeded()
      await page.waitForTimeout(350)
    },
  }]
}
module.exports = { createMcpScenes }
