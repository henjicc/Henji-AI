import { afterEach, expect, it } from 'vitest'
import {
  listGenerationTaskStatusSnapshots,
  publishCanvasGenerationTaskStatus,
  readGenerationTaskStatusSnapshot,
  replaceGenerationTaskStatusSnapshots,
  type GenerationTaskStatusSnapshot,
} from './generationTaskStatusRegistry'

const snapshot = (taskId: string): GenerationTaskStatusSnapshot => ({
  taskId, status: 'generating', progress: 42, modelId: 'test-model', mediaType: 'image',
  resultAvailable: false, errorCode: null, errorMessage: null,
  cancellable: true, waitingExternal: true,
})

afterEach(() => replaceGenerationTaskStatusSnapshots([]))

it('隔离写入、单条读取和列表读取，完整保留状态字段', () => {
  const input = snapshot('generation-copy')
  const expected = { ...input }
  replaceGenerationTaskStatusSnapshots([input])
  input.status = 'error'
  input.progress = 0
  const read = readGenerationTaskStatusSnapshot(expected.taskId)!
  expect(read).toEqual(expected)
  read.errorMessage = 'caller mutation'
  const listed = listGenerationTaskStatusSnapshots().find(item => item.taskId === expected.taskId)!
  expect(listed).toEqual(expected)
  listed.resultAvailable = true
  expect(readGenerationTaskStatusSnapshot(expected.taskId)).toEqual(expected)
  replaceGenerationTaskStatusSnapshots([{ ...expected, status: 'success', progress: 100, resultAvailable: true }])
  expect(readGenerationTaskStatusSnapshot(expected.taskId)).toMatchObject({ status: 'success', progress: 100, resultAvailable: true })
  replaceGenerationTaskStatusSnapshots([])
  expect(readGenerationTaskStatusSnapshot(expected.taskId)).toBeNull()
})

it('画布同名状态优先且独立于生成页替换，读写仍隔离', () => {
  const input = snapshot('canvas-copy')
  publishCanvasGenerationTaskStatus(input)
  input.status = 'error'
  replaceGenerationTaskStatusSnapshots([{ ...input, status: 'pending' }])
  const expected = { ...snapshot(input.taskId), origin: 'canvas' }
  const read = readGenerationTaskStatusSnapshot(input.taskId)!
  expect(read).toEqual(expected)
  read.waitingExternal = false
  const list = listGenerationTaskStatusSnapshots().filter(item => item.taskId === input.taskId)
  expect(list).toEqual([expected])
  list[0].status = 'success'
  replaceGenerationTaskStatusSnapshots([])
  expect(readGenerationTaskStatusSnapshot(input.taskId)).toEqual(expected)
})
