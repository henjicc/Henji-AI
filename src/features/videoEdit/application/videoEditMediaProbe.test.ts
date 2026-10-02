import { expect, it } from 'vitest'
import { videoEditMediaSchema } from '@/core/videoEdit/document'
import { resolveVideoEditMediaInspection, videoEditFieldsFromNativeProbe, videoEditNativeFormatLabel, type VideoEditBrowserInspection, type VideoEditNativeProbe, type VideoEditNativeProbeOutcome, type VideoEditNativeStream } from './videoEditMediaProbe'

type VideoInfo = NonNullable<VideoEditNativeStream['video']>
function videoStream(codec: string, profile: string | null, video: Partial<VideoInfo> = {}, decodable = true): VideoEditNativeStream {
  return { index: 0, kind: 'video', codec, profile, startTimeSeconds: 0, durationSeconds: 3, isAttachedPicture: false, decodable, video: { width: 3840, height: 2160, bitDepth: 8, chromaSubsampling: '4:2:0', hasAlpha: false, avgFrameRate: { num: 60, den: 1 }, realFrameRate: { num: 60, den: 1 }, rotationDegrees: null, ...video } }
}
function audioStream(codec: string, index = 1, decodable = true): VideoEditNativeStream {
  return { index, kind: 'audio', codec, profile: null, startTimeSeconds: 0, durationSeconds: 3, isAttachedPicture: false, decodable, audio: { sampleRate: 48000, channels: 2 } }
}
function probe(streams: VideoEditNativeStream[], formatName = 'mov,mp4,m4a,3gp,3g2,mj2', durationSeconds: number | null = 3): VideoEditNativeProbeOutcome {
  const result: VideoEditNativeProbe = { container: { formatName, startTimeSeconds: 0, durationSeconds }, primaryVideoStreamIndex: streams.find(stream => stream.kind === 'video')?.index ?? null, primaryAudioStreamIndex: streams.find(stream => stream.kind === 'audio')?.index ?? null, streams }
  return { status: 'probed', probe: result }
}
const browserMedia = { kind: 'video' as const, hasAudio: true, width: 3840, height: 2160, durationSeconds: 2.999, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' as const }
const browserDecodes: VideoEditBrowserInspection = { status: 'read', video: { codec: 'avc', decodable: true }, audio: { codec: 'aac', decodable: true }, media: browserMedia }
const browserCannot = (codec: string | null): VideoEditBrowserInspection => ({ status: 'read', video: { codec, decodable: false } })
const unreadable: VideoEditBrowserInspection = { status: 'unreadable', error: new Error('Input has an unsupported or unrecognizable format.') }
const prores4444 = videoStream('prores', '4444', { width: 2560, height: 2560, bitDepth: 12, chromaSubsampling: '4:4:4', hasAlpha: true })

it('原生与浏览器都能解：原生是主路径（默认）时为原生，不是主路径时整体留在浏览器（日志另记原生能解）；诊断强制原生须等原生播放接通；元数据都沿用浏览器结果', () => {
  const both = probe([videoStream('h264', 'High'), audioStream('aac')])
  expect(resolveVideoEditMediaInspection('D:/a.mp4', both, browserDecodes)).toEqual({ backend: 'native', nativeDecodes: true, fields: browserMedia })
  expect(resolveVideoEditMediaInspection('D:/a.mp4', both, browserDecodes, undefined, true, false)).toEqual({ backend: 'browser', nativeDecodes: true, fields: browserMedia })
  expect(resolveVideoEditMediaInspection('D:/a.mp4', both, browserDecodes, 'native')).toEqual({ backend: 'native', nativeDecodes: true, fields: browserMedia })
  expect(resolveVideoEditMediaInspection('D:/a.mp4', both, browserDecodes, 'native', false)).toEqual({ backend: 'browser', nativeDecodes: true, fields: browserMedia })
  expect(resolveVideoEditMediaInspection('D:/a.mp4', both, browserDecodes, undefined, true, true)).toEqual({ backend: 'native', nativeDecodes: true, fields: browserMedia })
})

it('只有原生能解的专业格式：原生播放接通前按具体格式拒绝；接通后后端为原生、元数据取自原生探测并通过工程素材校验', () => {
  expect(() => resolveVideoEditMediaInspection('D:/lotus.mov', probe([prores4444]), browserCannot(null), undefined, false)).toThrow('剪辑暂不能播放此视频格式（Apple ProRes 4444，12 位 4:4:4，带透明），请先转为 H.264 视频后再导入。')
  expect(() => resolveVideoEditMediaInspection('D:/a.mkv', probe([videoStream('h264', 'High'), audioStream('truehd')]), { status: 'read', video: { codec: 'avc', decodable: true }, audio: { codec: null, decodable: false } }, undefined, false)).toThrow('剪辑暂不能播放此声音格式（Dolby TrueHD）')
  // A file whose sound only native decodes plays natively as a whole (one backend per file).
  expect(resolveVideoEditMediaInspection('D:/a.mkv', probe([videoStream('h264', 'High'), audioStream('truehd')]), { status: 'read', video: { codec: 'avc', decodable: true }, audio: { codec: null, decodable: false } }).backend).toBe('native')
  const result = resolveVideoEditMediaInspection('D:/lotus.mov', probe([prores4444]), browserCannot(null))
  expect(result).toEqual({ backend: 'native', nativeDecodes: true, fields: { kind: 'video', hasAudio: false, width: 2560, height: 2560, durationSeconds: 3, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' } })
  expect(videoEditMediaSchema.parse({ id: 'm', name: 'lotus.mov', path: 'D:/lotus.mov', ...result.fields })).toBeTruthy()
  const mxf = resolveVideoEditMediaInspection('D:/dnxhr.mxf', probe([videoStream('dnxhd', 'DNXHR HQ', { width: 1920, height: 1080, chromaSubsampling: '4:2:2' }), audioStream('pcm_s24le'), audioStream('pcm_s24le', 2)], 'mxf', 3.003), unreadable, undefined, true)
  expect(mxf.fields).toMatchObject({ kind: 'video', hasAudio: true, width: 1920, height: 1080, durationSeconds: 3 })
  const mpeg2 = resolveVideoEditMediaInspection('D:/a.mpg', probe([videoStream('mpeg2video', 'Main', { avgFrameRate: { num: 30000, den: 1001 }, realFrameRate: { num: 30000, den: 1001 } }), audioStream('mp2')], 'mpeg'), unreadable, undefined, true)
  expect(mpeg2.fields).toMatchObject({ frameRate: { numerator: 30000, denominator: 1001 }, frameRateMode: 'sampled-constant' })
})

it('原生不可用或探测失败时回到浏览器；浏览器也不能解时说明具体格式与原因且不出现实现名称', () => {
  expect(resolveVideoEditMediaInspection('D:/a.mp4', { status: 'unavailable' }, browserDecodes)).toEqual({ backend: 'browser', nativeDecodes: false, fields: browserMedia })
  expect(resolveVideoEditMediaInspection('D:/a.mp4', { status: 'unreadable', message: 'OPEN_FAILED' }, browserDecodes).backend).toBe('browser')
  expect(resolveVideoEditMediaInspection('D:/a.mp4', probe([videoStream('h264', 'High 4:2:2', {}, false)]), browserDecodes).backend).toBe('browser')
  const messages = [
    [{ status: 'unavailable' }, browserCannot(null), 'D:/lotus.mov', '当前设备无法解码此视频（MOV 文件中的视频编码）。可重启软件后重试'],
    [{ status: 'unavailable' }, browserCannot('hevc'), 'D:/a.mp4', '当前设备无法解码此视频（HEVC）'],
    [{ status: 'unavailable' }, unreadable, 'D:/a.mxf', '当前无法读取此 MXF 文件'],
    [probe([{ ...prores4444, decodable: false }]), browserCannot(null), 'D:/lotus.mov', '无法解码此视频的编码格式（Apple ProRes 4444，12 位 4:4:4，带透明）'],
    [probe([videoStream('h264', 'High'), audioStream('truehd', 1, false)]), { status: 'read', video: { codec: 'avc', decodable: true }, audio: { codec: null, decodable: false } }, 'D:/a.mkv', '无法解码此文件的声音编码（Dolby TrueHD）'],
    [probe([]), unreadable, 'D:/a.mov', '文件没有可用的音视频轨道。'],
    [{ status: 'unavailable' }, { status: 'read', audio: { codec: 'ac3', decodable: false } }, 'D:/a.ac3', '当前设备无法解码此文件的声音（AC-3）'],
  ] as const
  for (const [native, browser, path, message] of messages) {
    let error: Error | undefined
    try { resolveVideoEditMediaInspection(path, native, browser) } catch (caught) { error = caught as Error }
    expect(error?.message).toContain(message)
    expect(error?.message).not.toMatch(/原生|浏览器|native|browser|mediabunny|webcodecs|ffmpeg/i)
  }
})

it('诊断强制后端时不静默换用另一后端', () => {
  expect(resolveVideoEditMediaInspection('D:/a.mp4', probe([videoStream('h264', 'High')]), browserDecodes, 'browser').backend).toBe('browser')
  expect(() => resolveVideoEditMediaInspection('D:/lotus.mov', probe([prores4444]), browserCannot(null), 'browser', true)).toThrow('当前设备无法解码此视频')
  expect(() => resolveVideoEditMediaInspection('D:/a.mp4', { status: 'unavailable' }, browserDecodes, 'native', true)).toThrow()
  expect(resolveVideoEditMediaInspection('D:/lotus.mov', probe([prores4444]), browserCannot(null), 'native').backend).toBe('native')
  // Without native playback a forced native cannot play anything natively; it never refuses browser-decodable files.
  expect(resolveVideoEditMediaInspection('D:/a.mp4', { status: 'unavailable' }, browserDecodes, 'native', false).backend).toBe('browser')
  expect(() => resolveVideoEditMediaInspection('D:/lotus.mov', probe([prores4444]), browserCannot(null), 'native', false)).toThrow('剪辑暂不能播放此视频格式')
})

it('原生元数据：旋转交换宽高、帧率不一致视为可变、封面图不算画面、缺少容器时长取流时长', () => {
  const rotated = videoEditFieldsFromNativeProbe((probe([videoStream('hevc', 'Main', { width: 1920, height: 1080, rotationDegrees: -90, avgFrameRate: { num: 29_970, den: 1000 }, realFrameRate: { num: 30, den: 1 } })], 'mov', null) as { probe: VideoEditNativeProbe }).probe)
  expect(rotated).toEqual({ kind: 'video', hasAudio: false, width: 1080, height: 1920, durationSeconds: 3, frameRate: { numerator: 30000, denominator: 1001 }, frameRateMode: 'variable' })
  // MPEG program stream starting at 0.533s: duration is the absolute end time, as the browser probe reports it.
  const mpegPs = { status: 'probed' as const, probe: { container: { formatName: 'mpeg', startTimeSeconds: 0.533, durationSeconds: 3 }, primaryVideoStreamIndex: 0, primaryAudioStreamIndex: 1, streams: [{ ...videoStream('mpeg2video', 'Main'), startTimeSeconds: 0.533, durationSeconds: 2.967 }, { ...audioStream('mp2'), startTimeSeconds: 0.5, durationSeconds: 3.033 }] } }
  expect(videoEditFieldsFromNativeProbe(mpegPs.probe).durationSeconds).toBeCloseTo(3.533, 9)
  expect(videoEditFieldsFromNativeProbe({ ...mpegPs.probe, container: { formatName: 'mpeg', startTimeSeconds: null, durationSeconds: null } }).durationSeconds).toBeCloseTo(3.533, 9)
  // A longer timecode track stretches the container but not the media (mediabunny counts audio/video tracks only).
  const timecode = { index: 2, kind: 'data' as const, codec: null, profile: null, startTimeSeconds: 0, durationSeconds: 3.666667, isAttachedPicture: false, decodable: false }
  expect(videoEditFieldsFromNativeProbe({ ...mpegPs.probe, container: { formatName: 'mov', startTimeSeconds: 0, durationSeconds: 3.666667 }, streams: [{ ...videoStream('h264', 'High'), durationSeconds: 3.016992 }, { ...audioStream('aac'), durationSeconds: 3 }, timecode] }).durationSeconds).toBe(3.016992)
  expect(videoEditFieldsFromNativeProbe({ ...mpegPs.probe, streams: [{ ...videoStream('h264', 'High'), durationSeconds: null }] }).durationSeconds).toBeCloseTo(3.533, 9)
  const cover = { ...videoStream('mjpeg', 'Baseline'), isAttachedPicture: true }
  expect(videoEditFieldsFromNativeProbe((probe([cover, audioStream('mp3')], 'mp3') as { probe: VideoEditNativeProbe }).probe)).toEqual({ kind: 'audio', hasAudio: true, width: 0, height: 0, durationSeconds: 3 })
  expect(videoEditFieldsFromNativeProbe((probe([videoStream('prores', 'HQ', { avgFrameRate: null, realFrameRate: { num: 50, den: 1 } })]) as { probe: VideoEditNativeProbe }).probe)).toMatchObject({ frameRate: { numerator: 50, denominator: 1 }, frameRateMode: 'unknown' })
  expect(videoEditNativeFormatLabel(videoStream('dnxhd', 'DNXHR HQX', { bitDepth: 10, chromaSubsampling: '4:2:2' }))).toBe('Avid DNxHR HQX，10 位 4:2:2')
  expect(videoEditNativeFormatLabel(videoStream('dnxhd', 'DNXHD', { width: 1920, height: 1080 }))).toBe('Avid DNxHD，8 位 4:2:0')
})
