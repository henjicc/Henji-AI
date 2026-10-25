// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { readAudioEditViewMemory, writeAudioEditViewMemory } from './audioEditViewMemory'

beforeEach(() => localStorage.clear())

it('每份口播各记各的播放头与缩放；超出素材长度或记录损坏时当作没有', () => {
  writeAudioEditViewMemory('a', { start: 1000, end: 5000, playhead: 2000 })
  writeAudioEditViewMemory('b', { start: 0, end: 800, playhead: 10 })
  expect(readAudioEditViewMemory('a', 10000)).toEqual({ start: 1000, end: 5000, playhead: 2000 })
  expect(readAudioEditViewMemory('b', 10000)).toEqual({ start: 0, end: 800, playhead: 10 })
  expect(readAudioEditViewMemory('a', 4000)).toBeNull()
  expect(readAudioEditViewMemory('missing', 10000)).toBeNull()
  localStorage.setItem('henji.audioEdit.viewMemory.v1', '{坏的')
  expect(readAudioEditViewMemory('a', 10000)).toBeNull()
})
