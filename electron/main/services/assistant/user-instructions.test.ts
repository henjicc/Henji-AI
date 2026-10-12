import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { getAssistantUserInstructions, getAssistantUserInstructionsFilePath, updateAssistantUserInstructions } from './user-instructions'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ shell: { openPath: vi.fn() } }))
vi.mock('../system', () => ({ getAppLocalDataDir: () => state.directory }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }))

it('用户指令保存失败保留原文件，重新读取仍是完整原文，重试成功才替换', async () => {
  state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-instructions-'))
  try {
    await updateAssistantUserInstructions({ content: '保留这份原始指令' })
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EIO' }))
    await expect(updateAssistantUserInstructions({ content: '新指令' })).rejects.toThrow('busy')
    rename.mockRestore()
    expect((await getAssistantUserInstructions()).content).toBe('保留这份原始指令')
    expect(await fs.readFile(getAssistantUserInstructionsFilePath(), 'utf8')).toBe('保留这份原始指令\n')
    await updateAssistantUserInstructions({ content: '新指令' })
    expect((await getAssistantUserInstructions()).content).toBe('新指令')
  } finally {
    vi.restoreAllMocks()
    await fs.rm(state.directory, { recursive: true, force: true })
  }
})
