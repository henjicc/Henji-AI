import type { ModelPresentation, ParamPresentationEntry } from '@/core/types/ModelPresentation'

type Label = { zh: string; en: string }

function speechModel(name: Label, fields: Record<string, Label>): ModelPresentation {
  const params: Record<string, ParamPresentationEntry> = {}
  for (const [id, label] of Object.entries(fields)) params[id] = { name: label }
  return { meta: { name }, params }
}

const voice: Label = { zh: '音色', en: 'Voice' }
const speed: Label = { zh: '语速', en: 'Speed' }
const format: Label = { zh: '音频格式', en: 'Audio format' }
const emotion: Label = { zh: '情感', en: 'Emotion' }
const version: Label = { zh: '版本', en: 'Version' }
const instruction: Label = { zh: '演绎指令', en: 'Delivery instruction' }

export const ttsPresentation: Record<string, ModelPresentation> = {
  'fal-minimax-speech-2.8': speechModel(
    { zh: 'MiniMax Speech 2.8 · Fal', en: 'MiniMax Speech 2.8 · Fal' },
    { falMinimaxSpeechSpec: version, falMinimaxSpeechVoice: voice, falMinimaxSpeechSpeed: speed, falMinimaxSpeechEmotion: emotion },
  ),
  'fal-qwen3-tts-1.7b': speechModel(
    { zh: 'Qwen3 TTS 1.7B · Fal', en: 'Qwen3 TTS 1.7B · Fal' },
    {
      falQwen3TtsVoice: voice,
      falQwen3TtsLanguage: { zh: '语言', en: 'Language' },
      falQwen3TtsStyle: instruction,
      falQwen3TtsTemperature: { zh: '表现变化', en: 'Variation' },
    },
  ),
  'fal-eleven-v3-tts': speechModel(
    { zh: 'Eleven v3 · Fal', en: 'Eleven v3 · Fal' },
    {
      falElevenV3Voice: voice,
      falElevenV3Stability: { zh: '稳定度', en: 'Stability' },
      falElevenV3Language: { zh: '语言代码', en: 'Language code' },
    },
  ),
  'bailian-minimax-speech-2.8': speechModel(
    { zh: 'MiniMax Speech 2.8 · 百炼', en: 'MiniMax Speech 2.8 · Bailian' },
    { bailianMinimaxSpeechSpec: version, bailianMinimaxSpeechVoice: voice, bailianMinimaxSpeechSpeed: speed, bailianMinimaxSpeechEmotion: emotion },
  ),
  'bailian-qwen-audio-3.1-tts-flash': speechModel(
    { zh: 'Qwen Audio 3.1 TTS Flash · 百炼', en: 'Qwen Audio 3.1 TTS Flash · Bailian' },
    { bailianQwenTtsVoice: voice, bailianQwenTtsInstruction: instruction, bailianQwenTtsSpeed: speed },
  ),
  'bailian-cosyvoice-v3.5': speechModel(
    { zh: 'CosyVoice 3.5 · 百炼', en: 'CosyVoice 3.5 · Bailian' },
    {
      bailianCosyVoiceSpec: version,
      bailianCosyVoiceId: { zh: '已创建的复刻或设计音色 ID', en: 'Existing cloned or designed voice ID' },
      bailianCosyVoiceInstruction: instruction,
      bailianCosyVoiceSpeed: speed,
    },
  ),
  'kie-eleven-turbo-2.5-tts': speechModel(
    { zh: 'Eleven Turbo 2.5 · KIE', en: 'Eleven Turbo 2.5 · KIE' },
    {
      kieElevenTurboVoice: voice,
      kieElevenTurboStability: { zh: '稳定度', en: 'Stability' },
      kieElevenTurboSpeed: speed,
    },
  ),
  'kie-eleven-v3-dialogue': speechModel(
    { zh: 'Eleven v3 对话语音 · KIE', en: 'Eleven v3 Dialogue · KIE' },
    { kieElevenDialogueVoice: voice },
  ),
  'kie-gemini-3.1-flash-tts': speechModel(
    { zh: 'Gemini 3.1 Flash TTS · KIE', en: 'Gemini 3.1 Flash TTS · KIE' },
    {
      kieGeminiTtsVoice: voice,
      kieGeminiTtsScene: { zh: '场景描述', en: 'Scene' },
      kieGeminiTtsTemperature: { zh: '表现变化', en: 'Variation' },
    },
  ),
  'siliconflow-cosyvoice2-tts': speechModel(
    { zh: 'CosyVoice2 · 硅基流动', en: 'CosyVoice2 · SiliconFlow' },
    { siliconflowCosyVoice: voice, siliconflowCosySpeed: speed, siliconflowCosyFormat: format },
  ),
  'siliconflow-moss-ttsd-0.5': speechModel(
    { zh: 'MOSS TTSD 0.5 · 硅基流动', en: 'MOSS TTSD 0.5 · SiliconFlow' },
    { siliconflowMossVoice: voice, siliconflowMossFormat: format },
  ),
  'volcengine-seed-tts-2.0': speechModel(
    { zh: '豆包 Seed-TTS 2.0', en: 'Doubao Seed-TTS 2.0' },
    { volcSeedTtsSpeaker: voice },
  ),
  'volcengine-seed-icl-2.0': speechModel(
    { zh: '豆包 Seed-ICL 2.0', en: 'Doubao Seed-ICL 2.0' },
    { volcSeedIclSpeaker: { zh: '已创建的复刻音色 ID', en: 'Existing cloned voice ID' } },
  ),
}

for (const [modelId, paramId] of [
  ['fal-minimax-speech-2.8', 'falMinimaxSpeechSpec'],
  ['bailian-minimax-speech-2.8', 'bailianMinimaxSpeechSpec'],
  ['bailian-cosyvoice-v3.5', 'bailianCosyVoiceSpec'],
]) ttsPresentation[modelId].params[paramId].role = 'mode'

for (const model of [ttsPresentation['fal-minimax-speech-2.8'], ttsPresentation['bailian-minimax-speech-2.8']]) {
  const id = Object.keys(model.params).find((key) => key.endsWith('Emotion'))!
  model.params[id].optionLabels = { '': { label: { zh: '自动', en: 'Auto' } } }
}
