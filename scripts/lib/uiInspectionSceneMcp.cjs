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
      await section.getByRole('switch').first().click()
      await section.getByPlaceholder('例如：Codex').fill('协议验收客户端')
      await section.getByRole('button', { name: '创建授权' }).click()
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
  }, { id: 'mcp-write-recovery', surface: '设置', name: '外部连接-受控写入与事实保留', writesUserData: true,
    setup: async (page) => {
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      const section = page.locator('#general-mcp')
      await section.getByRole('switch').nth(0).click()
      await section.getByRole('switch').nth(1).click()
      await section.getByRole('switch').nth(2).click()
      await section.getByPlaceholder('例如：Codex').fill('受控写入验收')
      await section.getByRole('button', { name: '创建授权' }).click()
      await waitReady(page)
      const config = await page.evaluate(async () => {
        const state = await window.henjiNative.mcp.status()
        const connection = state.connections.find((item) => item.name === '受控写入验收')
        return JSON.parse(await window.henjiNative.mcp.connectionConfig({ id: connection.id })).mcpServers.henji
      })
      const client = new Client({ name: 'Henji write Reality', version: '1' })
      const operations = []
      const call = async (name, args) => {
        const result = await client.callTool({ name, arguments: args })
        assert.equal(result.isError, false, JSON.stringify(result))
        return result.structuredContent
      }
      const read = (ref, propertyIds) => call('read_application_entity', { ref, propertyIds })
      const change = async (changes, reads) => {
        const args = { operationId: require('node:crypto').randomUUID(), baselineIds: reads.map((item) => item.baselineId), summary: '隔离验收修改', changes }
        const result = await call('change_application_entities', args)
        assert.equal(result.executionState, 'completed', JSON.stringify(result))
        assert.equal(result.verificationState, 'verified', JSON.stringify(result))
        const repeated = await call('change_application_entities', args)
        assert.deepEqual(repeated, result)
        operations.push(args.operationId)
        return result
      }
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } }))
        const settingsRef = { kind: 'settings.registry', id: 'singleton' }
        const settings = await read(settingsRef, ['interface.theme_tone'])
        const theme = settings.data.properties['interface.theme_tone'] === 'warm' ? 'cool' : 'warm'
        await change([{ kind: 'set_properties', entityType: settingsRef.kind, target: settingsRef, properties: { 'interface.theme_tone': theme } }], [settings])
        assert.equal((await read(settingsRef, ['interface.theme_tone'])).data.properties['interface.theme_tone'], theme)
        const models = await call('list_application_entities', { entityType: 'generation.model', limit: 1 })
        const modelRef = models.data.refs[0]; assert.ok(modelRef)
        const model = await read(modelRef, ['generation.model.hidden', 'generation.model.provider_id'])
        const hidden = !model.data.properties['generation.model.hidden']
        await change([{ kind: 'set_properties', entityType: modelRef.kind, target: modelRef, properties: { 'generation.model.hidden': hidden } }], [model])
        assert.equal((await read(modelRef, ['generation.model.hidden'])).data.properties['generation.model.hidden'], hidden)
        const catalog = await call('list_application_entities', { entityType: 'asset.catalog', limit: 1 })
        const catalogRef = catalog.data.refs[0]; assert.ok(catalogRef)
        const created = await change([{ kind: 'create_items', entityType: 'asset.library', parent: catalogRef, items: [{ properties: { 'asset.library.name': 'MCP新建集合' } }] }], [catalog])
        const libraryRef = created.result.data.resultRefs.find((item) => item.kind === 'asset.library'); assert.ok(libraryRef)
        const library = await read(libraryRef, ['asset.library.name'])
        assert.equal(library.data.properties['asset.library.name'], 'MCP新建集合')
        await change([{ kind: 'set_properties', entityType: 'asset.library', target: libraryRef, properties: { 'asset.library.name': 'MCP已改名集合' } }], [library])
        assert.equal((await read(libraryRef, ['asset.library.name'])).data.properties['asset.library.name'], 'MCP已改名集合')
        const projectRef = { kind: 'canvas.project', id: canvasFixtureProjectId }
        const project = await read(projectRef, ['canvas.project.name'])
        await change([{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'canvas.project.name': 'MCP已保存画布' } }], [project])
        assert.equal((await read(projectRef, ['canvas.project.name'])).data.properties['canvas.project.name'], 'MCP已保存画布')
        // 直接检查正式存储，不把协议 ok 当作持久化证据。
        const stored = await page.evaluate(async ({ libraryId, projectId }) => ({
          libraries: await window.henjiNative.assetLibrary.listLibraries(),
          settings: JSON.parse(localStorage.getItem('settings-storage')),
          hiddenModels: localStorage.getItem('hidden_models'),
          project: await window.henjiNative.storyboardProjects.getProjectRecord(projectId),
        }), { libraryId: libraryRef.id, projectId: canvasFixtureProjectId })
        const storedLibrary = stored.libraries.find((item) => String(item.id) === String(libraryRef.id))
        assert.ok(storedLibrary, `正式素材库缺少结果引用：${JSON.stringify({ libraryRef, libraries: stored.libraries })}`)
        assert.equal(storedLibrary.name, 'MCP已改名集合')
        assert.equal(stored.settings.state.themeTonePreset, theme)
        assert.equal(JSON.parse(stored.hiddenModels).includes(`${model.data.properties['generation.model.provider_id']}-${modelRef.id}`), hidden)
        assert.ok(stored.project, `正式画布存储缺少工程：${canvasFixtureProjectId}`)
        assert.equal(stored.project.name, 'MCP已保存画布')
        const freshCatalog = await call('list_application_entities', { entityType: 'asset.catalog', limit: 1 })
        const freshLibrary = await read(libraryRef, ['asset.library.name'])
        await change([{ kind: 'remove_items', entityType: 'asset.library', parent: catalogRef, targets: [libraryRef] }], [freshCatalog, freshLibrary])
        const remaining = await page.evaluate(() => window.henjiNative.assetLibrary.listLibraries())
        assert.equal(remaining.some((item) => String(item.id) === String(libraryRef.id)), false)
        await page.reload(); await waitReady(page)
        for (const operationId of operations) assert.equal((await call('get_application_operation', { operationId })).executionState, 'completed')
        const stale = await client.callTool({ name: 'change_application_entities', arguments: { operationId: require('node:crypto').randomUUID(), baselineIds: [project.baselineId], summary: '过期基线拒绝', changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'canvas.project.name': '不能写入' } }] } })
        assert.equal(stale.isError, true)
      } finally {
        await client.close()
        await page.evaluate(async () => { const state = await window.henjiNative.mcp.status(); await window.henjiNative.mcp.configure({ enabled: false, port: state.port }) })
      }
      await setupSettings(page)
      await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
      await page.locator('#general-mcp').scrollIntoViewIfNeeded()
    },
  }]
}
module.exports = { createMcpScenes }
