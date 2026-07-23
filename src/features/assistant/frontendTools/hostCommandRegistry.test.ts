// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { useProjectStore } from '@/stores/projectStore'

import { executeHostCommand } from './hostCommandRegistry'
import { executeHostQueryResult } from './hostQueryRegistry'

describe('assistant host command registry', () => {
  beforeEach(() => {
    useNavigationStore.setState({ activeWorkspace: 'generation', activeToolId: null, revision: 0 })
    useAssetLibraryStore.setState({ view: 'closed', sourceWorkspace: 'generation' })
    useProjectStore.setState({ isHydrated: true, projects: [], currentProjectId: null })
  })

  it('通过稳定命令切换工作区并返回 resulting revision', async () => {
    const result = await executeHostCommand({
      name: 'switch_workspace',
      input: { workspace: 'tools' },
    }, new AbortController().signal)

    expect(result.ok).toBe(true)
    expect(useNavigationStore.getState().activeWorkspace).toBe('tools')
    if (result.ok) expect(result.data).toEqual({ workspace: 'tools' })
  })

  it('scope revision 不一致时返回可恢复冲突', async () => {
    const result = await executeHostCommand({
      name: 'switch_workspace',
      input: { workspace: 'nodes' },
      expectedRevisions: { navigation: 999 },
    }, new AbortController().signal)

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'STALE_CONTEXT', recoverable: true },
    })
    expect(useNavigationStore.getState().activeWorkspace).toBe('generation')
  })

  it('取消信号会阻止命令执行', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await executeHostCommand({
      name: 'switch_workspace',
      input: { workspace: 'assets' },
    }, controller.signal)

    expect(result).toMatchObject({ ok: false, error: { code: 'ABORTED' } })
    expect(useNavigationStore.getState().activeWorkspace).toBe('generation')
  })

  it('画布项目不存在时不提前切换工作区', async () => {
    const result = await executeHostCommand({
      name: 'open_canvas_project',
      input: { projectId: 'missing-project' },
    }, new AbortController().signal)

    expect(result).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } })
    expect(useNavigationStore.getState().activeWorkspace).toBe('generation')
  })

  it('宿主查询失败时返回稳定错误而不是让调用方等待超时', async () => {
    const result = await executeHostQueryResult({
      name: 'get_model_schema',
      input: { modelId: 'missing-model' },
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', recoverable: false },
    })
  })
})
