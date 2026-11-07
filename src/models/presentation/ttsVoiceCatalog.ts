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

// Gemini 3.8 TTS 官方 70 个预设音色，按用途分组排列。
const gemini38Names = [
  'Bodi', 'Lumi', 'Sadaltager', 'Sola', 'Sulafat', 'Varo', 'Zephyr', 'Koda', 'Kore', 'Nika', 'Tavi', 'Zeno',
  'Algenib', 'Despina', 'Erinome', 'Kira', 'Ludo', 'Mako', 'Rasalgethi', 'Rina', 'Alnilam', 'Brio', 'Jori',
  'Laomedeia', 'Rami', 'Veda', 'Achird', 'Enzo', 'Riko', 'Sami', 'Zali', 'Zubenelgenubi', 'Algieba', 'Aoede',
  'Autonoe', 'Callirrhoe', 'Enceladus', 'Gero', 'Iapetus', 'Neno', 'Olin', 'Tari', 'Umbriel', 'Achernar',
  'Charon', 'Daro', 'Fola', 'Hali', 'Milo', 'Puck', 'Arlo', 'Cleo', 'Fenrir', 'Finn', 'Leda', 'Lora', 'Orus',
  'Enya', 'Jett', 'Knox', 'Nyla', 'Sadachbia', 'Vindemiatrix', 'Cruz', 'Elio', 'Gacrux', 'Pulcherrima',
  'Schedar', 'Tova', 'Zuri',
]

const siliconflowNames: Array<[string, string]> = [
  ['alex', '沉稳男声 Alex'], ['benjamin', '低沉男声 Benjamin'],
  ['charles', '磁性男声 Charles'], ['david', '欢快男声 David'],
  ['anna', '沉稳女声 Anna'], ['bella', '激情女声 Bella'],
  ['claire', '温柔女声 Claire'], ['diana', '欢快女声 Diana'],
]

// Groq Orpheus 官方音色，Groq 不提供音色列表接口，也不接受自定义音色。
const orpheusEnglishVoices: Array<[string, string, string]> = [
  ['autumn', 'Autumn', '女'], ['diana', 'Diana', '女'], ['hannah', 'Hannah', '女'],
  ['austin', 'Austin', '男'], ['daniel', 'Daniel', '男'], ['troy', 'Troy', '男'],
]
const orpheusArabicVoices: Array<[string, string, string]> = [
  ['abdullah', 'Abdullah', '男'], ['fahad', 'Fahad', '男'], ['sultan', 'Sultan', '男'],
  ['lulwa', 'Lulwa', '女'], ['noura', 'Noura', '女'], ['aisha', 'Aisha', '女'],
]

export const TTS_VOICE_SELECTORS: Record<string, VoiceSelectorConfig> = {
  'fal-minimax-speech-2.8': { voices: [systemVoice('Wise_Woman')], allowSearch: true, allowCustomId: true },
  'fal-eleven-v3-tts': { voices: elevenNames.map((name) => systemVoice(name)), allowSearch: true, allowCustomId: true },
  'fal-eleven-v4-tts': { voices: elevenNames.map((name) => systemVoice(name)), allowSearch: true, allowCustomId: true },
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
  // Plus 只有官方音色清单里的 4 个旗舰音色，不能与 Flash 的音色混用。
  'bailian-qwen-audio-3.1-tts-plus': {
    voices: [
      systemVoice('longanlingxin_v3.1', '龙安灵心_v3.1', '女'),
      systemVoice('xunanchuan_v3.1', '许南川', '男'),
      systemVoice('longanhuan_v3.1', '龙安欢_v3.1', '女'),
      systemVoice('longanfengyue_v3.1', '龙安风悦_v3.1', '女'),
    ],
    allowSearch: true,
    allowCustomId: true,
  },
  'bailian-cosyvoice-v3.5': {
    voices: [],
    allowSearch: true,
    allowCustomId: true,
    remoteModelId: 'bailian-cosyvoice-v3.5',
    customIdHint: '请先在百炼创建 CosyVoice 3.5 音色，再从列表选择',
  },
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
  'kie-gemini-3.8-flash-tts': { voices: gemini38Names.map((name) => systemVoice(name)), allowSearch: true },
  'kie-gemini-3.8-flash-lite-tts': { voices: gemini38Names.map((name) => systemVoice(name)), allowSearch: true },
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
  'groq-orpheus-v1-english': { voices: orpheusEnglishVoices.map(([id, name, gender]) => systemVoice(id, name, gender)) },
  'groq-orpheus-arabic-saudi': { voices: orpheusArabicVoices.map(([id, name, gender]) => systemVoice(id, name, gender)) },
  'volcengine-seed-tts-2.0': { voices: volcSystemVoices, allowSearch: true },
  'volcengine-seed-icl-2.0': {
    voices: volcSystemVoices,
    allowSearch: true,
    allowCustomId: true,
    customIdHint: '可直接选择系统音色；“克隆声音”完成后也会自动加入此列表',
    voiceLibrary: { providerId: 'volcengine-speech', modelId: 'volcengine-seed-icl-2.0', allowDelete: true },
  },
}
