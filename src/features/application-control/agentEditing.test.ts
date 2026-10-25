import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_EDITING_HOLD_MS, AgentEditingTakenOverError, agentEditDocumentIds, beginAgentEdit, isAgentAuthoredStep, isAgentEditingSession,
  isAgentWritingDocument, markAgentAuthoredStep, releaseAgentDocument, takeOverAgentDocument, useAgentEditingStore,
} from './agentEditing'

const caller = { kind: 'external' as const, name: 'Claude' }

describe('助手正在编辑哪份文档', () => {
  beforeEach(() => { vi.useFakeTimers(); useAgentEditingStore.setState({ sessions: {}, takenOver: {} }) })
  afterEach(() => { vi.useRealTimers() })

  it('写入期间算在编辑，写完保持一段时间再放开，免得两次写之间锁一下放一下', () => {
    const end = beginAgentEdit(['doc-a'], caller)
    expect(isAgentWritingDocument('doc-a')).toBe(true)
    expect(isAgentWritingDocument('doc-b')).toBe(false)
    end()
    expect(isAgentWritingDocument('doc-a')).toBe(false)
    expect(isAgentEditingSession(useAgentEditingStore.getState().sessions['doc-a'])).toBe(true)
    vi.advanceTimersByTime(AGENT_EDITING_HOLD_MS + 100)
    expect(useAgentEditingStore.getState().sessions['doc-a']).toBeUndefined()
  })

  it('同一份文档的并发写入要全部结束才算停', () => {
    const first = beginAgentEdit(['doc-a'], caller)
    const second = beginAgentEdit(['doc-a'], caller)
    first()
    expect(isAgentWritingDocument('doc-a')).toBe(true)
    second()
    second()
    expect(useAgentEditingStore.getState().sessions['doc-a'].active).toBe(0)
  })

  it('接管后放开锁并拒绝助手再写这份文档，交还后恢复；别的文档不受影响', () => {
    const end = beginAgentEdit(['doc-a'], caller)
    takeOverAgentDocument('doc-a')
    expect(useAgentEditingStore.getState().sessions['doc-a']).toBeUndefined()
    end()
    expect(() => beginAgentEdit(['doc-a', 'doc-b'], caller)).toThrow(AgentEditingTakenOverError)
    expect(() => beginAgentEdit(['doc-a'], caller)).toThrow(/USER_TAKEOVER/)
    expect(() => beginAgentEdit(['doc-b'], caller)()).not.toThrow()
    releaseAgentDocument('doc-a')
    expect(() => beginAgentEdit(['doc-a'], caller)()).not.toThrow()
  })

  it('从正式目标与通用实体写入里推出文档：文档引用就是 ID，文档内对象取 ID 前缀', () => {
    expect(agentEditDocumentIds({ resolveOperationWriteTargets: () => [{ kind: 'audio_edit.document', id: 'doc-a' }] }, {}, 'op')).toEqual(['doc-a'])
    expect(agentEditDocumentIds({}, { changes: [
      { kind: 'set_properties', target: { kind: 'audio_edit.transcript_block', id: 'doc-a:transcript-1' } },
      { kind: 'remove_items', parent: { kind: 'video_edit.sequence', id: 'doc-b:seq' }, targets: [{ kind: 'video_edit.clip', id: 'doc-b:clip' }] },
    ] }, 'op')).toEqual(['doc-a', 'doc-b'])
    expect(agentEditDocumentIds({ resolveOperationTargets: () => [{ kind: 'application.transaction', id: 'undo:1' }] }, {}, 'op')).toEqual([])
    expect(agentEditDocumentIds({ resolveOperationWriteTargets: () => { throw new Error('bad input') } }, {}, 'op')).toEqual([])
  })

  it('助手产生的步骤快照可以被认出来', () => {
    const snapshot = { id: 'doc-a' }
    expect(isAgentAuthoredStep(snapshot)).toBe(false)
    markAgentAuthoredStep(snapshot)
    expect(isAgentAuthoredStep(snapshot)).toBe(true)
  })
})
