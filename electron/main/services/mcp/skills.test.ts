// @vitest-environment node
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { LocalMcpServer } from './server'
import { McpConnections } from './connections'
import { ApplicationHostBridge } from '../application-runtime/applicationHostBridge'

// 与内置 Pi 的技能测试相同：使用仓库内正式技能目录，只把停用名单换成可控值。
const state = vi.hoisted(() => ({ disabled: [] as string[] }))
vi.mock('../assistant/skills/registry', async importOriginal => {
  const actual = await importOriginal<typeof import('../assistant/skills/registry')>()
  const dirs = () => ({ builtinDir: path.resolve('resources/assistant-skills'), userDir: '', disabledNames: state.disabled })
  return { ...actual,
    listEnabledAssistantSkills: async () => (await actual.scanAssistantSkills(dirs())).skills.filter(skill => skill.enabled),
    loadAssistantSkill: (name: string, relativePath?: string) => actual.loadAssistantSkillFrom(dirs(), name, relativePath),
  }
})

const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.reverse()) await close(); closers.length = 0; state.disabled = [] })

async function fixture() {
  let saved: string | null = null
  const connections = new McpConnections({ read: () => saved, write: (value) => { saved = value } })
  const caller = connections.create('外部智能体')
  const host = new ApplicationHostBridge((id) => connections.assertActive(id))
  const hostCalls: unknown[] = []
  host.register({ rendererEpoch: randomUUID(), attachmentSequence: 1, ready: true, domains: [], tools: [] }, { send: (_channel, payload) => { hostCalls.push(payload) } })
  const server = new LocalMcpServer(connections, host)
  await server.start(0)
  closers.push(() => server.stop())
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.listeningPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${connections.token(caller.id)}` } } })
  const client = new Client({ name: '技能验收', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  closers.push(() => client.close())
  await client.connect(transport)
  const call = async (args: Record<string, unknown>) => {
    const result = await client.callTool({ name: 'load_assistant_skill', arguments: args })
    return { isError: result.isError === true, body: result.structuredContent as { ok: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } }, text: JSON.stringify(result) }
  }
  const contract = async () => ((await client.callTool({ name: 'describe_application_contract', arguments: {} })).structuredContent as { data: { skills?: { tool: string; index: Array<Record<string, unknown>> }; workflows: string[] } }).data
  return { server, connections, caller, client, call, contract, hostCalls }
}

describe('外部 MCP 通过普通工具发现并读取运行时技能', () => {
  it('目录只多一个只读技能入口，契约只给已准入技能的名称与适用条件', async () => {
    const f = await fixture()
    const tools = (await f.client.listTools()).tools
    const skillTool = tools.find(tool => tool.name === 'load_assistant_skill')
    expect(skillTool?.annotations?.readOnlyHint).toBe(true)
    expect(skillTool?.inputSchema.required).toEqual(['name', 'reason'])
    const data = await f.contract()
    const names = data.skills!.index.map(item => item.name)
    expect(data.skills!.tool).toBe('load_assistant_skill')
    expect(names).toEqual(expect.arrayContaining(['video-edit-code-creation', 'prompt-optimization']))
    // 依赖已删除旧协议的内置技能不对任何智能体开放。
    expect(names).not.toContain('图片生成')
    for (const item of data.skills!.index) expect(Object.keys(item).sort()).toEqual(['description', 'name'])
    expect(Buffer.byteLength(JSON.stringify(data.skills), 'utf8')).toBeLessThan(2500)
    expect(data.workflows.some(line => line.includes('load_assistant_skill'))).toBe(true)
    expect(f.hostCalls).toHaveLength(0)
  })

  it('按需读取主文件与全部设计及接口参考，内容带信任标记，不经渲染宿主', async () => {
    const f = await fixture()
    const main = await f.call({ name: 'video-edit-code-creation', reason: '为剪辑写新的代码素材' })
    expect(main.isError, main.text).toBe(false)
    expect(main.body.data).toMatchObject({ name: 'video-edit-code-creation', path: null, source: 'builtin' })
    const referencePaths = [
      'references/annotations.md', 'references/author-api.md', 'references/author-shaders.md',
      'references/author-text-motion.md', 'references/brief-concept.md', 'references/color-texture.md',
      'references/examples.md', 'references/layout.md', 'references/motion.md', 'references/multifile-components.md',
      'references/parameter-types.md', 'references/parameters-curves.md', 'references/parametric.md', 'references/preferences.md', 'references/review.md',
      'references/shader-components-filters.md', 'references/shader-components-shapes-2.md', 'references/shader-components-shapes.md',
      'references/shader-components-stylize.md', 'references/shader-components-textures-2.md', 'references/shader-components-textures.md',
      'references/structure.md', 'references/styles.md', 'references/templates.md',
      'references/timeline-check.md', 'references/type.md',
    ]
    expect(main.body.data!.referencePaths).toEqual(referencePaths)
    expect(main.body.data!.content).toContain('trust=builtin')
    // 主文件只做路由，作者接口细节不随首轮正文下发。
    expect(main.body.data!.content).not.toContain('smoothstep')
    for (const relativePath of referencePaths) {
      const reference = await f.call({ name: 'video-edit-code-creation', path: relativePath, reason: '按当前创作阶段读取参考' })
      expect(reference.isError, reference.text).toBe(false)
      expect(reference.body.data).toMatchObject({ path: relativePath, source: 'builtin' })
      expect(reference.body.data!.content).toContain('trust=builtin')
      expect(reference.body.data!.bytes).toBeGreaterThan(0)
    }
    const api = await f.call({ name: 'video-edit-code-creation', path: 'references/author-api.md', reason: '写源码' })
    expect(api.isError, api.text).toBe(false)
    expect(api.body.data).toMatchObject({ path: 'references/author-api.md' })
    expect(api.body.data!.content).toContain('smoothstep')
    expect(f.hostCalls).toHaveLength(0)
  })

  it('越界路径、未准入、停用与不存在的参考都被拒绝，并给出可改道的选项', async () => {
    const f = await fixture()
    for (const bad of ['references/../SKILL.md', '../SKILL.md', 'C:/Windows/win.ini', '/etc/passwd', 'SKILL.md', 'references/../../agentSkills.ts']) {
      const rejected = await f.call({ name: 'video-edit-code-creation', path: bad, reason: '越界' })
      expect(rejected.isError, bad).toBe(true)
      expect(rejected.text).not.toContain('trust=builtin')
    }
    const missing = await f.call({ name: 'video-edit-code-creation', path: 'references/missing.md', reason: '猜测' })
    expect(missing.body.error?.message).toContain('SKILL_REFERENCE_NOT_FOUND')
    expect(missing.body.error?.message).toContain('references/author-api.md')
    const legacy = await f.call({ name: '图片生成', reason: '旧技能' })
    expect(legacy.body.error?.message).toContain('尚未适配')
    expect(legacy.body.error?.message).toContain('video-edit-code-creation')
    const unknownField = await f.call({ name: 'video-edit-code-creation', reason: '多余字段', script: 'x' })
    expect(unknownField.body.error?.message).toContain('INVALID_INPUT')
    state.disabled = ['video-edit-code-creation']
    const disabled = await f.call({ name: 'video-edit-code-creation', reason: '已停用' })
    expect(disabled.body.error?.message).toContain('SKILL_DISABLED')
    expect((await f.contract()).skills!.index.map(item => item.name)).not.toContain('video-edit-code-creation')
    state.disabled = []
    expect((await f.call({ name: 'video-edit-code-creation', reason: '恢复启用' })).isError).toBe(false)
  })

  it('撤销连接后无法再读取技能', async () => {
    const f = await fixture()
    expect((await f.call({ name: 'video-edit-code-creation', reason: '撤销前' })).isError).toBe(false)
    f.connections.revoke(f.caller.id)
    await f.server.revoke(f.caller.id)
    await expect(f.client.callTool({ name: 'load_assistant_skill', arguments: { name: 'video-edit-code-creation', reason: '撤销后' } })).rejects.toThrow()
  })
})
