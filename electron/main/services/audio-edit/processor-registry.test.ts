import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('./audio-worker-client', () => ({ invokeAudioWorker: async () => ({ plugins: [] }) }))
import { registerAudioEditProcessor } from './processor-registry'
import { listAudioEditProcessors, processAudioEditVstChain, audioEditProcessorCacheIdentity } from './processors'
it('registered processors share ordered processing and parameter validation; unregister invalidates availability', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-processor-'))
  const source = path.join(directory, 'source.wav'); await fs.writeFile(source, 'input')
  const process = vi.fn(async ({ outputPath, parameters }: { outputPath: string; parameters: Record<string, number> }) => { await fs.writeFile(outputPath, String(parameters.gain)) })
  const implementation = { descriptor: { id: 'builtin:test', name: 'Test', vendor: 'Henji', version: '1', available: true }, parameters: z.object({ gain: z.number().min(0).max(1) }).strict(), process }
  const unregister = registerAudioEditProcessor(implementation)
  try {
    expect(() => registerAudioEditProcessor(implementation)).toThrow('唯一')
    expect(await listAudioEditProcessors()).toContainEqual(implementation.descriptor)
    const recipe = [{ id: 'builtin:test', enabled: true, parameters: { gain: .5 } }]
    expect(await audioEditProcessorCacheIdentity(recipe)).toEqual([['builtin:test', '1', undefined, undefined]])
    const output = await processAudioEditVstChain(source, directory, recipe)
    expect(await fs.readFile(output.outputPath, 'utf8')).toBe('0.5')
    await expect(processAudioEditVstChain(source, directory, [{ ...recipe[0], parameters: { gain: 2 } }])).rejects.toThrow()
    expect(process).toHaveBeenCalledTimes(1)
    const repeated = await processAudioEditVstChain(source, directory, [...recipe, { ...recipe[0], parameters: { gain: .2 } }])
    expect(await fs.readFile(repeated.outputPath, 'utf8')).toBe('0.2')
    expect(process.mock.calls.at(-1)?.[0].parameters).toEqual({ gain: .2 })
    unregister()
    await expect(processAudioEditVstChain(source, directory, recipe)).rejects.toThrow('不可用')
  } finally { unregister(); await fs.rm(directory, { recursive: true, force: true }) }
})
