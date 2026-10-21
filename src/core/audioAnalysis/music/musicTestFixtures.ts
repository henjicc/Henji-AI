import { MUSIC_ANALYSIS_VERSION, MUSIC_TIMBRE_DIMS, type MusicAnalysis } from './musicAnalysis'

/**
 * 测试用的稳定节拍曲：120 BPM、4/4，按 8 小节一个段落排列 labels（如 'ABAC'），同标签段落逐拍特征相同，
 * 其余拍加入可复现的小扰动；前奏前留 0.25 秒弱起空白，尾奏在最后一拍后延续 2 秒。
 */
export function steadyMusicAnalysis(labels = 'IABABCABO', options: { beatSeconds?: number; barsPerSection?: number } = {}): MusicAnalysis {
  const beatSeconds = options.beatSeconds ?? 0.5, barsPerSection = options.barsPerSection ?? 8, bpb = 4
  const beats: number[] = [], positions: number[] = [], chroma: number[] = [], timbre: number[] = [], loudness: number[] = []
  const sections: MusicAnalysis['sections'] = []
  let seed = 7
  const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let s = 0; s < labels.length; s++) {
    sections.push({ startBeat: beats.length, label: labels[s] })
    const code = labels.charCodeAt(s)
    for (let bar = 0; bar < barsPerSection; bar++) for (let p = 0; p < bpb; p++) {
      beats.push(0.25 + beats.length * beatSeconds); positions.push(p)
      const vector = Array.from({ length: 12 }, (_, c) => Math.abs(Math.sin(code * 1.7 + bar * 0.9 + p * 0.37 + c)) + 0.02 * random())
      const norm = Math.hypot(...vector)
      chroma.push(...vector.map(value => value / norm))
      for (let d = 0; d < MUSIC_TIMBRE_DIMS; d++) timbre.push(Math.cos(code * 0.8 + bar * 0.5 + p * 0.3 + d * 1.3) + 0.02 * random())
      loudness.push(-14 - (code % 5) - p * 0.5 + 0.1 * random())
    }
  }
  return {
    version: MUSIC_ANALYSIS_VERSION, durationSeconds: beats.at(-1)! + 2, beatSource: 'beat_this', tempo: 60 / beatSeconds, beatsPerBar: bpb,
    beats, barPositions: positions, chroma, timbre, loudness, sections, regularity: 1, coverage: 1, suitable: true,
  }
}
