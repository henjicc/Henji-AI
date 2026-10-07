import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { closeVideoEditProject, listVideoEditInstances } from './videoEditService'
import { getVideoEditPlaybackResolution, resetVideoEditPlaybackResolutionCache, setVideoEditPlaybackResolution } from './videoEditPlaybackResolution'
import { VideoEditMutationExecutor } from './videoEditExecutors'
import type { ApplicationPlannedStep } from '@/core/application-control'

beforeEach(() => {
  installHarnessNativeStorage(); localStorage.clear(); resetVideoEditPlaybackResolutionCache()
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('回放分辨率按剪辑记在本机：界面写入后重新读取仍在，其他剪辑不受影响；剪辑内容与撤销历史不变', async () => {
  const owner = (await createVideoEditProject())!; const other = (await createVideoEditProject())!
  const id = owner.document.id; const before = owner.document; const history = owner.past.length
  expect(getVideoEditPlaybackResolution(id)).toEqual({ resolution: 'full', fullWhenPaused: true })
  setVideoEditPlaybackResolution(id, { resolution: 'quarter' })
  expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
  resetVideoEditPlaybackResolutionCache()
  expect(getVideoEditPlaybackResolution(id)).toEqual({ resolution: 'quarter', fullWhenPaused: true })
  expect(getVideoEditPlaybackResolution(other.document.id)).toEqual({ resolution: 'full', fullWhenPaused: true })
  expect(() => setVideoEditPlaybackResolution(id, { resolution: 'third' as never })).toThrow()
})

it('助手经通用读写改回放分辨率：读回一致，越界取值被拒并保持原值，事务撤销回到修改前', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  const app = createApplicationHarness(); const projectRef = { kind: 'video_edit.document', id }
  const read = async (): Promise<unknown> => (await app.read(projectRef, ['video_edit.document.playback_resolution']) as { properties: Record<string, unknown> }).properties['video_edit.document.playback_resolution']
  try {
    expect(await read()).toEqual({ resolution: 'full', fullWhenPaused: true })
    const changed = await app.change(projectRef, { 'video_edit.document.playback_resolution': { resolution: 'eighth', fullWhenPaused: false } })
    expect(changed.ok).toBe(true)
    expect(getVideoEditPlaybackResolution(id)).toEqual({ resolution: 'eighth', fullWhenPaused: false })
    expect(await read()).toEqual({ resolution: 'eighth', fullWhenPaused: false })
    expect((await app.change(projectRef, { 'video_edit.document.playback_resolution': { resolution: '1/3', fullWhenPaused: true } })).ok).toBe(false)
    expect(getVideoEditPlaybackResolution(id)).toEqual({ resolution: 'eighth', fullWhenPaused: false })
  } finally { app.dispose() }
  // 事务撤销（补偿）回到修改前的选择
  const executor = new VideoEditMutationExecutor('video_edit.document')
  const result = await executor.apply({ kind: 'mutation', entityType: projectRef.kind, target: projectRef, expectedRevisions: {}, mutations: [{ propertyId: 'video_edit.document.playback_resolution', operation: 'set', value: { resolution: 'half', fullWhenPaused: true } }] } satisfies Extract<ApplicationPlannedStep, { kind: 'mutation' }>)
  expect(getVideoEditPlaybackResolution(id)).toEqual({ resolution: 'half', fullWhenPaused: true })
  await executor.undo(result.undoToken!)
  expect(getVideoEditPlaybackResolution(id)).toEqual({ resolution: 'eighth', fullWhenPaused: false })
})
