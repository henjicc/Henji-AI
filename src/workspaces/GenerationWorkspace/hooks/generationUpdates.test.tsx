// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GenerationTask } from '../types'
import type { GenerationHistoryFilterState } from '@/stores/generationHistoryFilterStore'

const persistence = vi.hoisted(() => ({ save: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }))
const locale = vi.hoisted(() => ({ currentLanguage: 'zh' }))
vi.mock('@/hooks/useI18n', () => ({ useI18n: () => locale }))
vi.mock('./useTaskHistory', () => ({ persistGenerationTask: persistence.save, deletePersistedGenerationTask: persistence.remove }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn() }) }))
vi.mock('../application/visibleGenerationTaskCommand', () => ({ publishVisibleGenerationTaskStatus: vi.fn() }))
vi.mock('@/utils/modelHelpers', () => ({ getModelDisplayName: vi.fn((id: string) => `模型 ${id}`) }))
import { getModelDisplayName } from '@/utils/modelHelpers'
import { useTaskState } from './useTaskState'
import { useTaskFilters } from './useTaskFilters'

const filters: Pick<GenerationHistoryFilterState, 'keyword' | 'providerId' | 'modelId' | 'mediaType' | 'timePreset' | 'startDate' | 'endDate'> = {
  keyword: '', providerId: 'all', modelId: 'all', mediaType: 'all', timePreset: 'all', startDate: '', endDate: '',
}
function task(id: string): GenerationTask {
  return { id, createdAt: new Date('2026-09-01'), type: 'image', prompt: `人物 ${id}`, model: 'model', provider: 'provider', status: 'success' }
}
afterEach(() => { cleanup(); vi.clearAllMocks(); locale.currentLanguage = 'zh' })

it('修改一项只保存该项，重排不写入，删除只删除对应任务', () => {
  const a = task('a'), b = task('b'), c = task('c')
  const { result } = renderHook(() => useTaskState())
  act(() => result.current.hydrateTasks([a, b, c]))
  act(() => result.current.setTasks([c, a, b]))
  expect(persistence.save).not.toHaveBeenCalled()
  act(() => result.current.updateTask('a', { prompt: '改后' }))
  expect(persistence.save).toHaveBeenCalledTimes(1)
  expect(persistence.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', prompt: '改后' }))
  expect(result.current.tasks[0]).toBe(c)
  expect(result.current.tasks[2]).toBe(b)
  act(() => result.current.setTasks(current => current.filter(item => item.id !== 'b')))
  expect(persistence.remove).toHaveBeenCalledTimes(1)
  expect(persistence.remove).toHaveBeenCalledWith('b')
  expect(persistence.save).toHaveBeenCalledTimes(1)
})

it('万条历史修改一项时，旧列表访问量随记录数线性增长', () => {
  const count = 10000
  let reads = 0
  const previous = new Proxy(Array.from({ length: count }, (_, i) => task(String(i))), {
    get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver) },
  })
  const { result } = renderHook(() => useTaskState())
  act(() => result.current.hydrateTasks(previous))
  reads = 0
  act(() => result.current.updateTask('9999', { prompt: '改后' }))
  expect(persistence.save).toHaveBeenCalledTimes(1)
  expect(reads).toBeLessThanOrEqual(count * 4)
})

it('重复确认同一图片尺寸不再次遍历历史或发起写入', () => {
  let reads = 0
  const items = new Proxy([task('a'), { ...task('b'), options: { resultImageDimensions: [{ width: 640, height: 480 }] } }], {
    get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver) },
  })
  const { result } = renderHook(() => useTaskState())
  act(() => result.current.hydrateTasks(items))
  reads = 0
  act(() => result.current.rememberResultImageDimensions('b', 0, { width: 640, height: 480 }))
  expect(result.current.tasks).toBe(items)
  expect(reads).toBe(items.length)
  expect(persistence.save).not.toHaveBeenCalled()
})

it('无关渲染不重复筛选；条件、数据及搜索字段变化仍正确更新', () => {
  const tasks = [task('a'), { ...task('b'), type: 'video' as const, error: '恢复失败' }]
  const { result, rerender } = renderHook(({ tasks, criteria }) => useTaskFilters(tasks, { ...criteria }), {
    initialProps: { tasks, criteria: { ...filters } },
  })
  const previous = result.current.filteredTasks
  vi.mocked(getModelDisplayName).mockClear()
  rerender({ tasks, criteria: { ...filters } })
  expect(result.current.filteredTasks).toBe(previous)
  expect(getModelDisplayName).not.toHaveBeenCalled()
  rerender({ tasks, criteria: { ...filters, keyword: '恢复' } })
  expect(result.current.filteredTasks.map(item => item.id)).toEqual(['b'])
  rerender({ tasks, criteria: { ...filters, mediaType: 'image' } })
  expect(result.current.filteredTasks.map(item => item.id)).toEqual(['a'])
  rerender({ tasks: [...tasks, task('c')], criteria: { ...filters } })
  expect(result.current.filteredTasks).toHaveLength(3)
  vi.mocked(getModelDisplayName).mockImplementation(() => locale.currentLanguage === 'en' ? 'English model' : '中文模型')
  rerender({ tasks, criteria: { ...filters, keyword: 'English' } })
  expect(result.current.filteredTasks).toEqual([])
  locale.currentLanguage = 'en'
  rerender({ tasks, criteria: { ...filters, keyword: 'English' } })
  expect(result.current.filteredTasks.map(item => item.id)).toEqual(['a', 'b'])
  vi.mocked(getModelDisplayName).mockImplementation(() => '用户别名')
  act(() => window.dispatchEvent(new Event('modelVisibilityChanged')))
  expect(result.current.filteredTasks).toEqual([])
})

// 显式专项保留真实 Hook 路径；不把机器耗时阈值放进日常单测。
if (process.env.GENERATION_UPDATE_BENCH === '1') {
  it('benchmark: 历史更新及无关重渲染', () => {
    const measurements = []
    for (const count of [100, 1000, 10000]) {
      const tasks = Array.from({ length: count }, (_, i) => task(String(i)))
      const state = renderHook(() => useTaskState())
      act(() => state.result.current.hydrateTasks(tasks))
      const filter = renderHook(() => useTaskFilters(tasks, { ...filters, keyword: '人物' }))
      const updates = [], unrelatedRenders = []
      for (let i = 0; i < 12; i++) {
        let start = performance.now()
        act(() => state.result.current.updateTask(String(count - 1), { prompt: `修改 ${i}` }))
        updates.push(performance.now() - start)
        start = performance.now()
        filter.rerender()
        unrelatedRenders.push(performance.now() - start)
      }
      const median = (values: number[]): number => values.slice(2).sort((a, b) => a - b)[5]
      measurements.push({ count, updateMedianMs: median(updates), unrelatedRenderMedianMs: median(unrelatedRenders) })
      state.unmount(); filter.unmount()
    }
    process.stdout.write(`[generation-update-bench] ${JSON.stringify(measurements)}\n`)
  })
}
