import type { MinimalEvaluationCase } from './minimal-evaluator'

export const MINIMAL_ASSISTANT_EVALUATION_CASES: MinimalEvaluationCase[] = [
  {
    id: 'generation-visible-task',
    category: 'golden',
    goal: '使用已验证图片模型生成一张图片，并让我能在生成工作区看到任务。',
    expectedIntent: 'generate',
    expectedTerminalStatuses: ['completed'],
    expectedTools: [{
      toolName: 'create_visible_generation_task', minCalls: 1, maxCalls: 1,
      requiredInputKeys: ['modelId', 'prompt', 'mediaType'],
    }],
    forbiddenTools: ['query_diagnostic_events', 'add_canvas_node'],
    maxLatencyMs: 60_000,
    maxInputTokens: 20_000,
    maxOutputTokens: 4_000,
  },
  {
    id: 'diagnostic-evidence',
    category: 'golden',
    goal: '读取最近错误的日志证据并诊断原因，不要执行修复。',
    expectedIntent: 'diagnose',
    expectedTerminalStatuses: ['completed'],
    expectedTools: [{
      toolName: 'query_diagnostic_events', minCalls: 1, maxCalls: 1,
      requiredInputKeys: ['from', 'to'],
    }],
    forbiddenTools: ['create_visible_generation_task', 'add_canvas_node'],
    maxLatencyMs: 30_000,
    maxInputTokens: 20_000,
    maxOutputTokens: 4_000,
    sensitiveProbes: ['sk-stage5-sensitive-probe'],
  },
  {
    id: 'canvas-compose-and-focus',
    category: 'golden',
    goal: '在明确画布项目添加上传图片和 AI 图片生成节点，连接并定位生成节点。',
    expectedIntent: 'canvas',
    expectedTerminalStatuses: ['completed'],
    expectedTools: [
      { toolName: 'search_canvas_node_types', minCalls: 1 },
      { toolName: 'get_canvas_node_schema', minCalls: 2 },
      { toolName: 'add_canvas_node', minCalls: 2, requiredInputKeys: ['projectId', 'nodeType', 'placement'] },
      { toolName: 'connect_canvas_nodes', minCalls: 1, maxCalls: 1 },
      { toolName: 'focus_canvas_node', minCalls: 1, maxCalls: 1 },
    ],
    forbiddenTools: ['create_visible_generation_task', 'query_diagnostic_events'],
    maxLatencyMs: 30_000,
    maxInputTokens: 30_000,
    maxOutputTokens: 6_000,
  },
]
