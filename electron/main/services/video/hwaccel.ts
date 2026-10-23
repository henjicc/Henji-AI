import { recordingKeyframes, type RecordingCodec, type RecordingEncoder, type RecordingEncoding, type ResolvedRecordingEncoding } from '../../../../src/core/screenRecording/encoding'
import { execFile } from 'node:child_process'
import fs from 'node:fs'

import { getProgramFilePath } from '../appPaths'
import { loadFfmpegPath } from './ffmpeg-loader'

type H264EncoderId = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'h264_videotoolbox'
export type HwEncoderId = H264EncoderId | 'hevc_nvenc' | 'hevc_qsv' | 'hevc_amf' | 'hevc_videotoolbox'
export type EncoderChoice = H264EncoderId | 'cpu'

export interface VideoEncoderProfile<Id extends string = EncoderChoice> {
  id: Id
  label: string
  buildEncodeArgs: (videoBitrateKbps: number, maxrateKbps: number, bufsizeKbps: number) => string[]
}

const CPU_PROFILE: VideoEncoderProfile = {
  id: 'cpu',
  label: 'CPU (libx264)',
  buildEncodeArgs: (videoBitrateKbps, maxrateKbps, bufsizeKbps) => [
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '26',
    '-b:v', `${videoBitrateKbps}k`,
    '-maxrate', `${maxrateKbps}k`,
    '-bufsize', `${bufsizeKbps}k`,
  ],
}

// 码率/maxrate/bufsize 与 CPU 档保持同一套目标体积计算，只替换编码器自身的质量控制参数，
// 尽量让硬件编码路径的画质/体积表现贴近 libx264 -crf 26 的效果，而不是另开一套标准。
const HW_PROFILES: Record<H264EncoderId, VideoEncoderProfile> = {
  h264_nvenc: {
    id: 'h264_nvenc',
    label: 'NVIDIA NVENC',
    buildEncodeArgs: (v, maxr, buf) => [
      '-c:v', 'h264_nvenc',
      '-preset', 'p4',
      '-tune', 'hq',
      '-rc', 'vbr',
      '-cq', '26',
      '-b:v', `${v}k`,
      '-maxrate', `${maxr}k`,
      '-bufsize', `${buf}k`,
    ],
  },
  h264_qsv: {
    id: 'h264_qsv',
    label: 'Intel Quick Sync',
    buildEncodeArgs: (v, maxr, buf) => [
      '-c:v', 'h264_qsv',
      '-preset', 'medium',
      '-global_quality', '26',
      '-b:v', `${v}k`,
      '-maxrate', `${maxr}k`,
      '-bufsize', `${buf}k`,
    ],
  },
  h264_amf: {
    id: 'h264_amf',
    label: 'AMD AMF',
    buildEncodeArgs: (v, maxr, buf) => [
      '-c:v', 'h264_amf',
      '-quality', 'quality',
      '-rc', 'vbr_peak',
      '-b:v', `${v}k`,
      '-maxrate', `${maxr}k`,
      '-bufsize', `${buf}k`,
    ],
  },
  h264_videotoolbox: {
    id: 'h264_videotoolbox',
    label: 'Apple VideoToolbox',
    buildEncodeArgs: (v, maxr, buf) => [
      '-c:v', 'h264_videotoolbox',
      '-allow_sw', '0',
      '-profile:v', 'high',
      '-b:v', `${v}k`,
      '-maxrate', `${maxr}k`,
      '-bufsize', `${buf}k`,
    ],
  },
}

// -allow_sw 0 同时用于探测和实际编码：VideoToolbox 在没有硬件编码能力时会静默退回软件
// 实现而不是报错，不加这个参数会让探测永远"成功"，实际上并没有用上硬件加速。

function candidatesForPlatform(): H264EncoderId[] {
  if (process.platform === 'win32') return ['h264_nvenc', 'h264_qsv', 'h264_amf']
  if (process.platform === 'darwin') return ['h264_videotoolbox']
  return []
}

interface HwaccelCacheFile {
  probeVersion: number
  platform: string
  arch: string
  encoderId: EncoderChoice
  detectedAt: number
}

// 3：Windows FFmpeg 换为与原生解码服务同一份 9.0 GPL 构建（重要记录 014），可用编码器随构建变化，重新探测。
const HWACCEL_PROBE_VERSION = 3

function getCacheFilePath(): string {
  return getProgramFilePath('hwaccel-cache.json')
}

function readCache(): HwaccelCacheFile | null {
  try {
    const raw = fs.readFileSync(getCacheFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as HwaccelCacheFile
    // 平台/架构指纹校验：自定义数据目录理论上可能被搬到别的机器，指纹不符就当缓存无效重新探测
    if (
      parsed.probeVersion !== HWACCEL_PROBE_VERSION
      || parsed.platform !== process.platform
      || parsed.arch !== process.arch
    ) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(encoderId: EncoderChoice): void {
  const entry: HwaccelCacheFile = {
    probeVersion: HWACCEL_PROBE_VERSION,
    platform: process.platform,
    arch: process.arch,
    encoderId,
    detectedAt: Date.now(),
  }
  try {
    fs.writeFileSync(getCacheFilePath(), JSON.stringify(entry, null, 2))
  } catch {
    // 缓存写入失败不影响本次编码，只是下次启动会重新探测一次
  }
}

async function probeEncoder(encoderId: HwEncoderId): Promise<boolean> {
  const ffmpegPath = await loadFfmpegPath()
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    // NVENC 会拒绝过小画面；256x256 能覆盖主流硬件编码器的最小尺寸要求。
    '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=1',
    '-frames:v', '1',
    ...(encoderId.endsWith('videotoolbox') ? ['-allow_sw', '0'] : []),
    '-c:v', encoderId,
    '-f', 'null', '-',
  ]
  return new Promise((resolve) => {
    execFile(ffmpegPath, args, { timeout: 8000 }, (error) => {
      resolve(!error)
    })
  })
}

async function detectEncoder(): Promise<EncoderChoice> {
  for (const candidate of candidatesForPlatform()) {
    if (await probeEncoder(candidate)) return candidate
  }
  return 'cpu'
}

function profileFor(encoderId: EncoderChoice): VideoEncoderProfile {
  return encoderId === 'cpu' ? CPU_PROFILE : HW_PROFILES[encoderId as H264EncoderId]
}

let inFlightDetection: Promise<VideoEncoderProfile> | null = null

/**
 * 硬件编码器探测只做一次并落盘缓存（跨进程重启复用，同机器不用每次启动都重新探测）。
 * 调用方在实际编码用缓存的编码器失败时应调用 invalidateEncoderCache 触发重新探测，
 * 用于识别用户更换/拔掉显卡、驱动升级等硬件环境变化。
 */
export function getPreferredEncoder(): Promise<VideoEncoderProfile> {
  if (inFlightDetection) return inFlightDetection
  const cached = readCache()
  if (cached) {
    inFlightDetection = Promise.resolve(profileFor(cached.encoderId))
    return inFlightDetection
  }
  inFlightDetection = detectEncoder().then((encoderId) => {
    writeCache(encoderId)
    return profileFor(encoderId)
  })
  return inFlightDetection
}

export async function invalidateEncoderCache(): Promise<VideoEncoderProfile> {
  inFlightDetection = null
  try {
    fs.unlinkSync(getCacheFilePath())
  } catch {
    // 缓存文件不存在时忽略
  }
  return getPreferredEncoder()
}

export function isHardwareEncoder(profile: VideoEncoderProfile): boolean {
  return profile.id !== 'cpu'
}


const recordingVendors = { nvidia: 'nvenc', intel: 'qsv', amd: 'amf', apple: 'videotoolbox' } as const
const recordingProbes = new Map<HwEncoderId, Promise<boolean>>()
function probeRecordingEncoder(id: HwEncoderId): Promise<boolean> {
  if (!recordingProbes.has(id)) recordingProbes.set(id, probeEncoder(id))
  return recordingProbes.get(id)!
}
/** 界面只展示当前平台实测可用的硬件；H.264 与 HEVC 分别探测。 */
export async function recordingEncoderChoices(codec: RecordingCodec): Promise<RecordingEncoder[]> {
  const vendors: RecordingEncoder[] = process.platform === 'darwin' ? ['apple'] : process.platform === 'win32' ? ['nvidia', 'intel', 'amd'] : []
  const choices: RecordingEncoder[] = ['auto']
  for (const vendor of vendors) {
    const suffix = recordingVendors[vendor as keyof typeof recordingVendors]
    if (await probeRecordingEncoder(`${codec}_${suffix}` as HwEncoderId)) choices.push(vendor)
  }
  return [...choices, 'software']
}
/** sceneCut 只在 x264/x265 与 NVENC 上生效。NVENC 需要预读才会补关键帧；预读 20 帧实测让画面晚出约 60ms、录制起点估算随之后移，4 帧检出效果相同且无可测延迟。QSV/AMF/VideoToolbox 未实测，保持固定间隔。 */
export function recordingEncoderProfile(codec: RecordingCodec, encoder: Exclude<RecordingEncoder, 'auto'>, rateControl: NonNullable<RecordingEncoding['rateControl']>, sceneCut = false): VideoEncoderProfile<HwEncoderId | 'cpu'> {
  const id = encoder === 'software' ? 'cpu' : `${codec}_${recordingVendors[encoder]}` as HwEncoderId
  return { id, label: encoder, buildEncodeArgs: (v, maxr, buf) => {
    const quality = rateControl === 'quality', cbr = rateControl === 'cbr'
    const codecName = id === 'cpu' ? codec === 'hevc' ? 'libx265' : 'libx264' : id
    const base = ['-c:v', codecName]
    if (encoder === 'software') base.push('-preset', 'superfast', '-tune', 'zerolatency', ...(quality ? ['-crf', '26'] : []), ...(codec === 'h264' ? ['-sc_threshold', sceneCut ? '40' : '0'] : []), ...(cbr && codec === 'h264' ? ['-x264-params', 'nal-hrd=cbr:force-cfr=1'] : []), ...(codec === 'hevc' ? ['-x265-params', `bframes=0:scenecut=${sceneCut ? 40 : 0}${cbr ? ':strict-cbr=1' : ''}`] : []))
    if (encoder === 'nvidia') base.push('-preset', 'p4', '-tune', 'll', '-rc', cbr ? 'cbr' : 'vbr', ...(quality ? ['-cq', '26'] : []), '-rc-lookahead', sceneCut ? '4' : '0', ...(sceneCut ? [] : ['-no-scenecut', '1']), '-forced-idr', '1')
    if (encoder === 'intel') base.push('-preset', 'veryfast', ...(quality ? ['-global_quality', '26'] : []), '-look_ahead', '0')
    if (encoder === 'amd') base.push('-quality', 'speed', '-rc', cbr ? 'cbr' : 'vbr_peak', ...(quality ? ['-qp_i', '26', '-qp_p', '26'] : []))
    if (encoder === 'apple') base.push('-allow_sw', '0', '-realtime', '1', ...(quality ? ['-q:v', '65'] : []))
    return [...base, '-b:v', `${quality && encoder === 'nvidia' ? 0 : v}k`, '-maxrate', `${maxr}k`, '-bufsize', `${buf}k`, ...(cbr ? ['-minrate', `${v}k`] : [])]
  } }
}
export async function getRecordingEncoder(options: ResolvedRecordingEncoding): Promise<VideoEncoderProfile<HwEncoderId | 'cpu'>> {
  let vendor = options.encoder
  if (vendor === 'auto') {
    const preferred = await getPreferredEncoder()
    vendor = preferred.id === 'cpu' ? 'software' : Object.entries(recordingVendors).find(([, suffix]) => preferred.id.endsWith(suffix))?.[0] as Exclude<RecordingEncoder, 'auto'> ?? 'software'
  }
  if (vendor !== 'software' && !await probeRecordingEncoder(`${options.codec}_${recordingVendors[vendor]}` as HwEncoderId)) vendor = 'software'
  return recordingEncoderProfile(options.codec, vendor, options.rateControl, recordingKeyframes(options.keyframeFrames).sceneCut)
}
