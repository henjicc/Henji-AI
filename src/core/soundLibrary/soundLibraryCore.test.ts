import { describe, expect, it } from 'vitest'
import { parseSoundName } from './soundName'
import { analyzeSoundPcm, SOUND_ANALYSIS_SAMPLE_RATE as SR } from './soundFeatures'
import { searchSoundIndex, soundNameScore, type SoundIndexEntry } from './soundSearch'

describe('双语音效文件名', () => {
  it.each([
    ['Riser 2 - 立管 2.wav', 'Riser 2', '立管 2', ['riser']],
    ['Ping 1 - 平1.wav', 'Ping 1', '平1', ['ping']],
    ['嗖03-中   Whoosh 3 - Medium.mp3', 'Whoosh 3 - Medium', '嗖03-中', ['whoosh', 'medium']],
    ['iPhone_按键哒02.wav', 'iPhone', '按键哒02', ['iphone']],
    ['blop_07 - blop_07.wav', 'blop 07', null, ['blop']],
    ['Footstep Wood  - 脚步木2.wav', 'Footstep Wood', '脚步木2', ['footstep', 'wood']],
    ['键盘敲击_打字02.wav', null, '键盘敲击 打字02', []],
    ['Sci-Fi Message 3 - Short.mp3', 'Sci-Fi Message 3 - Short', null, ['sci', 'fi', 'message', 'short']],
  ])('%s', (file, english, chinese, words) => {
    const name = parseSoundName(file)
    expect(name.english).toBe(english); expect(name.chinese).toBe(chinese); expect(name.englishWords).toEqual(words)
  })
})

function burst(seconds: number, peakAt: number, length: number): Float32Array {
  return Float32Array.from({ length: Math.round(length * SR) }, (_, i) => {
    const t = i / SR, distance = Math.abs(t - peakAt)
    return t < seconds ? 0 : Math.exp(-distance * 40) * Math.sin(2 * Math.PI * 900 * t)
  })
}

describe('起音点、击中点与响度', () => {
  it('起音点是第一次进入峰值 -20 dB，击中点落在能量峰', () => {
    const features = analyzeSoundPcm([burst(0.1, 0.5, 1.2)])
    expect(features.durationSeconds).toBeCloseTo(1.2, 3)
    expect(features.hitSeconds).toBeGreaterThan(0.49); expect(features.hitSeconds).toBeLessThan(0.51)
    expect(features.attackSeconds).toBeGreaterThan(0.4); expect(features.attackSeconds).toBeLessThan(features.hitSeconds)
    expect(features.peakDbfs).toBeGreaterThan(-1); expect(features.peakDbfs).toBeLessThanOrEqual(0)
  })
  it('满幅 1 kHz 正弦的最大瞬时响度约为 -3 LUFS（BS.1770 校准点），明暗按频谱重心', () => {
    const sine = Float32Array.from({ length: SR }, (_, i) => Math.sin(2 * Math.PI * 997 * i / SR))
    const features = analyzeSoundPcm([sine])
    expect(features.loudnessLufs!).toBeCloseTo(-3.01, 1)
    expect(features.brightnessHz!).toBeGreaterThan(900); expect(features.brightnessHz!).toBeLessThan(1100)
  })
  it('全静音不报击中点与响度', () => {
    expect(analyzeSoundPcm([new Float32Array(4800)])).toMatchObject({ peakDbfs: null, loudnessLufs: null, hitSeconds: 0 })
  })
})

function entry(file: string, folder = 'MG音效', durationSeconds = 1, embedding?: number[]): SoundIndexEntry {
  const name = parseSoundName(file)
  return { id: file, folderId: 'f', relativePath: `${folder}/${file}`, ...name, folderTerms: [folder], features: { durationSeconds, attackSeconds: 0, hitSeconds: 0.2, peakDbfs: -3, loudnessLufs: -12, brightnessHz: 3000 }, ...(embedding ? { embedding: Float32Array.from(embedding) } : {}) }
}

describe('名字匹配与听音融合', () => {
  it('英文名可靠、近义词与中文子串也能命中，机翻中文不误导', () => {
    expect(soundNameScore(['whoosh'], entry('Swish 8 - 嗖嗖嗖嗖 7.wav'))).toBe(0.85)
    expect(soundNameScore(['嗖'], entry('Swish 8 - 嗖嗖嗖嗖 7.wav'))).toBeCloseTo(0.82, 3)
    expect(soundNameScore(['嗖02'], entry('嗖02-短.wav'))).toBeGreaterThan(soundNameScore(['嗖02'], entry('简单的嗖嗖02.wav')))
    expect(soundNameScore(['pop'], entry('Pop 6 - 流行 6.wav'))).toBe(1)
    expect(soundNameScore(['流行音乐'], entry('Pop 6 - 流行 6.wav'))).toBe(0)
    expect(soundNameScore(['键盘'], entry('打字02.wav', '电脑手机相关/键盘'))).toBe(0.4)
    expect(soundNameScore(['metal hit'], entry('Metal 3 - 金属 3.wav'))).toBe(0.5)
    expect(soundNameScore(['metal hit'], entry('冲击金属3-长   Hit Metal 4 - Long.mp3'))).toBe(1)
  })
  it('时长过滤，名字与听音都不够时判定没有合适的', () => {
    const library = [entry('Whoosh 1.wav', 'a', 0.5, [1, 0]), entry('Whoosh 2.wav', 'a', 3, [1, 0]), entry('Bell.wav', 'a', 1, [0, 1])]
    const short = searchSoundIndex(library, { keywords: ['whoosh'], maxDurationSeconds: 1, limit: 5 })
    expect(short.hits.map(hit => hit.entry.id)).toEqual(['Whoosh 1.wav']); expect(short.noGoodMatch).toBe(false)
    const heard = searchSoundIndex(library, { keywords: [], descriptionEmbedding: Float32Array.from([0, 1]), limit: 2 })
    expect(heard.hits[0].entry.id).toBe('Bell.wav'); expect(heard.hits[0].matchedBy).toEqual(['listening'])
    const none = searchSoundIndex(library, { keywords: ['heartbeat'], descriptionEmbedding: Float32Array.from([Math.SQRT1_2 * 0.1, Math.SQRT1_2 * 0.1]), limit: 3 })
    expect(none.noGoodMatch).toBe(true)
  })
})
