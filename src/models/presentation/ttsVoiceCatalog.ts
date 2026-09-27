import type { VoiceSelectorConfig } from '@/core/types/PanelTypes'
import { buildVoiceFeatureTags } from '@/core/voice/voiceFeatureTags'
import qwenVoices from './data/qwen-audio-3.1-voices.json'
import volcVoices from './data/volc-seed-tts-2-voices.json'

type Voice = VoiceSelectorConfig['voices'][number]

function systemVoice(id: string, name = id, description?: string): Voice {
  return {
    id,
    name,
    description,
    tags: buildVoiceFeatureTags({ voiceId: id, voiceName: name, description, source: 'system' }),
  }
}

const qwenSystemVoices: Voice[] = qwenVoices.map((item) => systemVoice(item.id, item.name, item.description))
const volcSystemVoices: Voice[] = volcVoices.map((item) => systemVoice(item.id, item.name, item.description))

const elevenNames = [
  'Rachel', 'Aria', 'Roger', 'Sarah', 'Laura', 'Charlie', 'George', 'Callum', 'River',
  'Liam', 'Charlotte', 'Alice', 'Matilda', 'Will', 'Jessica', 'Eric', 'Chris', 'Brian', 'Daniel', 'Lily', 'Bill',
]

const geminiNames = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
  'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
  'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
]

const siliconflowNames: Array<[string, string]> = [
  ['alex', '沉稳男声 Alex'], ['benjamin', '低沉男声 Benjamin'],
  ['charles', '磁性男声 Charles'], ['david', '欢快男声 David'],
  ['anna', '沉稳女声 Anna'], ['bella', '激情女声 Bella'],
  ['claire', '温柔女声 Claire'], ['diana', '欢快女声 Diana'],
]

export const TTS_VOICE_SELECTORS: Record<string, VoiceSelectorConfig> = {
  'fal-minimax-speech-2.8': { voices: [systemVoice('Wise_Woman')], allowSearch: true, allowCustomId: true },
  'fal-eleven-v3-tts': { voices: elevenNames.map((name) => systemVoice(name)), allowSearch: true, allowCustomId: true },
  'bailian-minimax-speech-2.8': {
    voices: [systemVoice('male-qn-qingse', '青涩青年音色')],
    allowSearch: true,
    allowCustomId: true,
    remoteModelId: 'bailian-minimax-speech-2.8',
  },
  'bailian-qwen-audio-3.1-tts-flash': {
    voices: qwenSystemVoices,
    allowSearch: true,
    allowCustomId: true,
    remoteModelId: 'bailian-qwen-audio-3.1-tts-flash',
  },
  'bailian-cosyvoice-v3.5': {
    voices: [],
    allowSearch: true,
    allowCustomId: true,
    remoteModelId: 'bailian-cosyvoice-v3.5',
    customIdHint: '请先在百炼创建 CosyVoice 3.5 音色，再从列表选择',
  },
  'kie-eleven-turbo-2.5-tts': { voices: [systemVoice('Rachel')], allowSearch: true, allowCustomId: true },
  'kie-eleven-v3-dialogue': {
    voices: [
      systemVoice('EkK5I93UQWFDigLMpZcX', '示例音色 1'),
      systemVoice('Z3R5wn05IrDiVCyEkUrK', '示例音色 2'),
      systemVoice('NNl6r8mD7vthiJatiJt1', '示例音色 3'),
    ],
    allowSearch: true,
    allowCustomId: true,
  },
  'kie-gemini-3.1-flash-tts': { voices: geminiNames.map((name) => systemVoice(name)), allowSearch: true },
  'siliconflow-cosyvoice2-tts': {
    voices: siliconflowNames.map(([id, name]) => systemVoice(`FunAudioLLM/CosyVoice2-0.5B:${id}`, name)),
    allowSearch: true,
    allowCustomId: true,
    remoteModelId: 'siliconflow-cosyvoice2-tts',
  },
  'siliconflow-moss-ttsd-0.5': {
    voices: [systemVoice('fnlp/MOSS-TTSD-v0.5:alex', 'Alex')],
    allowSearch: true,
    allowCustomId: true,
  },
  'volcengine-seed-tts-2.0': { voices: volcSystemVoices, allowSearch: true },
  'volcengine-seed-icl-2.0': {
    voices: [],
    allowSearch: true,
    allowCustomId: true,
    customIdHint: '切换到“克隆声音”模式创建音色，完成后会自动加入此列表',
    voiceLibrary: { providerId: 'volcengine-speech', modelId: 'volcengine-seed-icl-2.0', allowDelete: true },
  },
}
