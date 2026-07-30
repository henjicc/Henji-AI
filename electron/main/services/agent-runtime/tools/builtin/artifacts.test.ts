import { describe, expect, it } from 'vitest'

import {
  AGENT_ARTIFACT_SCHEMA_VERSION,
  type AgentArtifactDescriptor,
  type AgentArtifactPage,
} from '../../../../../../src/core/assistant/artifacts'
import { shouldOffloadObservation } from '../../context/offload'
import { AgentToolGateway, AgentToolGatewayError } from '../gateway'
import { createBuiltinAgentToolRegistry } from './index'

function descriptor(dataClass: 'C1' | 'C2' | 'C3'): AgentArtifactDescriptor {
  return {
    schemaVersion: AGENT_ARTIFACT_SCHEMA_VERSION,
    artifactRef: `artifact:${dataClass}`,
    source: 'query_assets:call-1',
    dataClasses: [dataClass],
    createdAt: new Date().toISOString(),
    originalBytes: 10_000,
    rootKind: 'object',
    topLevelFields: ['items'],
  }
}

function page(dataClass: 'C1' | 'C2' | 'C3'): AgentArtifactPage {
  const content = dataClass === 'C1'
    ? 'x'.repeat(4 * 1024)
    : JSON.stringify({ items: ['result'] })
  return {
    schemaVersion: AGENT_ARTIFACT_SCHEMA_VERSION,
    artifactRef: `artifact:${dataClass}`,
    source: 'query_assets:call-1',
    dataClasses: [dataClass],
    contentEncoding: 'json-fragment',
    content,
    returnedBytes: Buffer.byteLength(content, 'utf8'),
    totalBytes: dataClass === 'C1' ? 8 * 1024 : Buffer.byteLength(content, 'utf8'),
    nextCursor: dataClass === 'C1' ? 'v1:4096:0123456789abcdef' : null,
    hasMore: dataClass === 'C1',
    selectedFields: [],
  }
}

function request(dataClass: 'C1' | 'C2' | 'C3') {
  return {
    runId: 'run-artifact',
    threadId: 'thread-artifact',
    toolCallId: `call-${dataClass}`,
    toolName: 'read_agent_artifact',
    input: { artifactRef: `artifact:${dataClass}` },
    approvalMode: 'full_access' as const,
    explicitUserIntent: true,
    signal: new AbortController().signal,
  }
}

describe('read_agent_artifact', () => {
  it('C1 分页结果经统一网关返回且不会再次被递归 offload', async () => {
    const registry = createBuiltinAgentToolRegistry(
      async () => { throw new Error('测试不执行前端工具') },
      {
        describe: ({ artifactRef }) => descriptor(artifactRef.endsWith('C1') ? 'C1' : 'C2'),
        read: ({ artifactRef }) => page(artifactRef.endsWith('C1') ? 'C1' : 'C2'),
      }
    )
    const gateway = new AgentToolGateway({
      registry,
      getHostContext: () => null,
      appendPermissionAudit: async () => {},
    })

    const result = await gateway.execute(request('C1'))
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.observation.dataClasses).toEqual(['C1'])
    expect(shouldOffloadObservation(result.observation.output)).toBe(false)
  })

  it('C2 每次读取都进入审批，C3 在读取前即拒绝', async () => {
    const registry = createBuiltinAgentToolRegistry(
      async () => { throw new Error('测试不执行前端工具') },
      {
        describe: ({ artifactRef }) => descriptor(
          artifactRef.endsWith('C2') ? 'C2' : 'C3'
        ),
        read: ({ artifactRef }) => page(artifactRef.endsWith('C2') ? 'C2' : 'C3'),
      }
    )
    const gateway = new AgentToolGateway({
      registry,
      getHostContext: () => null,
      appendPermissionAudit: async () => {},
    })

    await expect(gateway.execute(request('C2'))).resolves.toMatchObject({
      status: 'approval_required',
      approval: { dataClasses: ['C2'], destination: '当前 Agent 模型上下文' },
    })
    await expect(gateway.execute(request('C3'))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    } satisfies Partial<AgentToolGatewayError>)
  })
})
