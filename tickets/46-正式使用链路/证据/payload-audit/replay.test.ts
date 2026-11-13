// @vitest-environment jsdom
/**
 * 记录回放（只读）：把 11-12/11-13 真实日志里模型发出的每次工具调用参数，拿新的工具定义（Pi 的同一个校验器）重新校验；
 * 把能解析的工具结果原文（日志里 ≤4000 字的）按新投影重算体积。不执行任何工具，不碰用户资料。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { z } from 'D:/VibeCode/Henji-AI/node_modules/zod'
import { validateToolArguments } from 'D:/VibeCode/Henji-AI/node_modules/@earendil-works/pi-ai/dist/index.js'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { APPLICATION_CAPABILITY_IDS, type LocalTool } from '@/core/application-control/localHostContracts'
import { buildApplicationToolCatalog } from 'D:/VibeCode/Henji-AI/electron/main/services/application-runtime/toolCatalog'
import { projectApplicationToolResult } from 'D:/VibeCode/Henji-AI/electron/main/services/application-runtime/resultProjection'

// 日志文件用逗号分隔传入 PAYLOAD_AUDIT_LOGS；结果写到 PAYLOAD_AUDIT_OUT（默认 .tmp/payload-audit）
const LOGS = (process.env.PAYLOAD_AUDIT_LOGS ?? '').split(',').filter(Boolean)
const OUT = `${process.env.PAYLOAD_AUDIT_OUT ?? 'D:/VibeCode/Henji-AI/.tmp/payload-audit'}/replay.json`

it('replay', () => {
  if (!LOGS.length) throw new Error('请用 PAYLOAD_AUDIT_LOGS 传入日志文件（逗号分隔）')
  const hostTools: LocalTool[] = APPLICATION_CAPABILITY_IDS.map(id => {
    const d = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!
    return { id, version: d.version, title: d.title, description: d.description, inputSchema: z.toJSONSchema(d.inputSchema, { io: 'input' }) }
  })
  const catalog = buildApplicationToolCatalog({ tools: hostTools, includeSkillTool: true })
  const byName = new Map(catalog.tools.map(tool => [tool.name, tool]))
  const calls: Array<{ name: string; ok: boolean; write?: boolean; error?: string; before?: number; after?: number }> = []
  const loads = { domains: 0, names: 0, task: 0 }
  for (const file of LOGS) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('embedded_agent.turn.tool_executed')) continue
      let event: { context?: { tool?: { toolName?: string; args?: Record<string, unknown>; resultText?: string; isError?: boolean } } }
      try { event = JSON.parse(line) } catch { continue }
      const tool = event.context?.tool
      if (tool?.toolName === 'load_application_tools') {
        const args = tool.args ?? {}
        if (Array.isArray(args.names) && args.names.length) loads.names++; else if (args.task) loads.task++; else loads.domains++
        continue
      }
      if (!tool?.toolName || tool.toolName === 'read_assistant_context') continue
      const definition = byName.get(tool.toolName)
      if (!definition) { calls.push({ name: tool.toolName, ok: false, error: 'not in catalog' }); continue }
      let ok = true; let error: string | undefined
      try { validateToolArguments({ name: definition.name, description: definition.description, parameters: definition.inputSchema } as never, { type: 'toolCall', id: 'x', name: definition.name, arguments: tool.args ?? {} } as never) }
      catch (e) { ok = false; error = String(e).slice(0, 300) }
      let before: number | undefined; let after: number | undefined
      if (tool.resultText && tool.resultText.length < 4000 && !tool.isError) {
        try {
          const old = JSON.parse(tool.resultText)
          before = tool.resultText.length
          after = JSON.stringify(projectApplicationToolResult(tool.toolName, tool.args ?? {}, old)).length
        } catch { /* 截断或非 JSON */ }
      }
      calls.push({ name: tool.toolName, ok, write: definition.annotations?.readOnlyHint === false, error, before, after })
    }
  }
  writeFileSync(OUT, JSON.stringify({ calls, loads }), 'utf8')
}, 300000)
