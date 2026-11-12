// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { createVideoEditMulticam } from '@/core/videoEdit/multicam'

const boundary = vi.hoisted(() => ({ instance: undefined as unknown, proxies: {} as Record<string, unknown>, generating: new Set<string>(), create: vi.fn(async () => undefined) }))
vi.mock('./videoEditService', () => ({ requireVideoEditInstance: () => boundary.instance, listVideoEditInstances: () => [boundary.instance], publishVideoEdit: vi.fn() }))
vi.mock('./videoEditProxy', () => ({
  getVideoEditProxySources: () => boundary.proxies, getVideoEditProxyPreference: () => ({ enabled: false, autoCreate: false }), ensureVideoEditProxyState: async () => undefined,
  readVideoEditProxyState: (_: string, id: string) => ({ status: boundary.generating.has(id) ? 'generating' : 'none', progress: 0, error: '' }), createVideoEditProxies: boundary.create,
}))
vi.mock('./videoEditMediaProbe', () => ({ videoEditNativeMediaProbe: { probe: async () => ({ status: 'probed', probe: { container: { formatName: 'mp4', startTimeSeconds: 0, durationSeconds: 20 }, primaryVideoStreamIndex: 0, primaryAudioStreamIndex: null,
  streams: [{ index: 0, kind: 'video', codec: 'h264', profile: 'High', startTimeSeconds: 0, durationSeconds: 20, isAttachedPicture: false, bitRate: 150e6, decodable: true, video: { width: 3840, height: 2160, bitDepth: 8, chromaSubsampling: '4:2:0', hasAlpha: false, avgFrameRate: { num: 60, den: 1 }, realFrameRate: { num: 60, den: 1 }, rotationDegrees: null } }] } }) } }))

const { createVideoEditMulticamProxies, dismissVideoEditMulticamProxyPrompt, ensureVideoEditMulticamPlayback, reportVideoEditMulticamPlayback, videoEditMulticamProxyPromptVisible } = await import('./videoEditMulticamPlayback')

function fixture(cameras: number): string {
  const document = createVideoEditTestDocument('多机位负载')
  document.media = Array.from({ length: cameras }, (_, index) => ({ id: `media-${index}`, name: `机位${index}`, path: `D:/${index}.mp4`, kind: 'video' as const, width: 3840, height: 2160, durationSeconds: 20, frameRate: { numerator: 60, denominator: 1 } }))
  document.items = document.media.map(media => ({ id: `item-${media.id}`, name: media.name, kind: 'video' as const, mediaId: media.id }))
  const result = createVideoEditMulticam(document, document.sequences[0].id, { name: '同步', sync: 'in_points', cameras: document.items.map(item => ({ itemId: item.id })), audioCameraIndex: 0 })
  boundary.instance = { document: { ...result.document, id: 'p' } }
  return result.document.sequences.find(sequence => sequence.multicam)!.id
}
const proxy = { path: 'D:/p.mp4', key: 'a'.repeat(64), contentIdentity: 'b'.repeat(64), preset: 'auto', width: 1920, height: 1080, bytes: 1 }

beforeEach(() => { localStorage.clear(); boundary.proxies = {}; boundary.generating.clear(); boundary.create.mockClear() })

it('4 路 4K60 H.264 原片判为可能卡顿并提示（1080P / 720P 两档）；关掉或点了创建后，批量生成途中不再提示，换了机位素材才再提示', async () => {
  const sourceId = fixture(4)
  const playback = await ensureVideoEditMulticamPlayback('p', sourceId)
  expect(playback).toMatchObject({ realtime: 'may_stutter', originals: ['media-0', 'media-1', 'media-2', 'media-3'], withoutProxy: ['media-0', 'media-1', 'media-2', 'media-3'], proxyChoices: [{ value: 'auto', label: '1080P' }, { value: '720p', label: '720P' }] })
  expect(videoEditMulticamProxyPromptVisible('p', sourceId, playback)).toBe(true)
  await createVideoEditMulticamProxies('p', sourceId, '720p')
  expect(boundary.create).toHaveBeenCalledWith('p', ['media-0', 'media-1', 'media-2', 'media-3'], '720p')
  expect(videoEditMulticamProxyPromptVisible('p', sourceId, await ensureVideoEditMulticamPlayback('p', sourceId))).toBe(false)
  // 生成是逐个的：第一路建好、第二路在生成、后两路还在排队（状态仍是 none），负载仍带不动，也不再提示。
  boundary.proxies = { 'media-0': proxy }; boundary.generating.add('media-1')
  const midway = await ensureVideoEditMulticamPlayback('p', sourceId)
  expect(midway).toMatchObject({ realtime: 'may_stutter', withoutProxy: ['media-2', 'media-3'] })
  expect(videoEditMulticamProxyPromptVisible('p', sourceId, midway)).toBe(false)
  // 换了一组机位素材的多机位：再提示。
  boundary.proxies = {}; boundary.generating.clear()
  const other = fixture(5)
  expect(videoEditMulticamProxyPromptVisible('p', other, await ensureVideoEditMulticamPlayback('p', other))).toBe(true)
  dismissVideoEditMulticamProxyPrompt('p', other, await ensureVideoEditMulticamPlayback('p', other))
  expect(videoEditMulticamProxyPromptVisible('p', other, await ensureVideoEditMulticamPlayback('p', other))).toBe(false)
})

it('机位都有代理、正在生成，或估算带得动时不提示', async () => {
  const two = fixture(2)
  expect(await ensureVideoEditMulticamPlayback('p', two)).toMatchObject({ realtime: 'smooth' })
  const four = fixture(4)
  boundary.proxies = Object.fromEntries(['media-0', 'media-1', 'media-2', 'media-3'].map(id => [id, proxy]))
  const proxied = await ensureVideoEditMulticamPlayback('p', four)
  expect(proxied).toMatchObject({ realtime: 'smooth', originals: [] })
  expect(videoEditMulticamProxyPromptVisible('p', four, proxied)).toBe(false)
  boundary.proxies = {}; for (const id of ['media-0', 'media-1', 'media-2', 'media-3']) boundary.generating.add(id)
  const generating = await ensureVideoEditMulticamPlayback('p', four)
  expect(generating).toMatchObject({ realtime: 'may_stutter', withoutProxy: [] })
  expect(videoEditMulticamProxyPromptVisible('p', four, generating)).toBe(false)
})

it('估算带得动、实际逐帧播放明显丢帧后，同一组素材改判为可能卡顿', async () => {
  const sourceId = fixture(2)
  expect((await ensureVideoEditMulticamPlayback('p', sourceId)).realtime).toBe('smooth')
  const { load } = await ensureVideoEditMulticamPlayback('p', sourceId)
  reportVideoEditMulticamPlayback('p', sourceId, { load, droppedRatio: .4, expectedFrames: 60 })
  expect((await ensureVideoEditMulticamPlayback('p', sourceId)).realtime).toBe('smooth')
  reportVideoEditMulticamPlayback('p', sourceId, { load, droppedRatio: .4, expectedFrames: 600 })
  expect((await ensureVideoEditMulticamPlayback('p', sourceId)).realtime).toBe('may_stutter')
})
