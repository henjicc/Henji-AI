import type { ModelPresentation, ParamPresentationEntry } from '@/core/types/ModelPresentation'
import { TTS_VOICE_SELECTORS } from './ttsVoiceCatalog'

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
    { zh: 'MiniMax Speech 2.8', en: 'MiniMax Speech 2.8' },
    { falMinimaxSpeechSpec: version, falMinimaxSpeechVoice: voice, falMinimaxSpeechSpeed: speed, falMinimaxSpeechEmotion: emotion },
  ),
  'fal-qwen3-tts-1.7b': speechModel(
    { zh: 'Qwen3 TTS 1.7B', en: 'Qwen3 TTS 1.7B' },
    {
      falQwen3TtsVoice: voice,
      falQwen3TtsLanguage: { zh: '语言', en: 'Language' },
      falQwen3TtsStyle: instruction,
      falQwen3TtsTemperature: { zh: '表现变化', en: 'Variation' },
    },
  ),
  'fal-eleven-v3-tts': speechModel(
    { zh: 'Eleven v3', en: 'Eleven v3' },
    {
      falElevenV3Voice: voice,
      falElevenV3Stability: { zh: '稳定度', en: 'Stability' },
      falElevenV3Language: { zh: '语言代码', en: 'Language code' },
    },
  ),
  'bailian-minimax-speech-2.8': speechModel(
    { zh: 'MiniMax Speech 2.8', en: 'MiniMax Speech 2.8' },
    { bailianMinimaxSpeechSpec: version, bailianMinimaxSpeechVoice: voice, bailianMinimaxSpeechSpeed: speed, bailianMinimaxSpeechEmotion: emotion },
  ),
  'bailian-qwen-audio-3.1-tts-flash': speechModel(
    { zh: 'Qwen Audio 3.1 TTS Flash', en: 'Qwen Audio 3.1 TTS Flash' },
    { bailianQwenTtsVoice: voice, bailianQwenTtsInstruction: instruction, bailianQwenTtsSpeed: speed },
  ),
  'bailian-cosyvoice-v3.5': speechModel(
    { zh: 'CosyVoice 3.5', en: 'CosyVoice 3.5' },
    {
      bailianCosyVoiceSpec: version,
      bailianCosyVoiceId: voice,
      bailianCosyVoiceInstruction: instruction,
      bailianCosyVoiceSpeed: speed,
    },
  ),
  'kie-eleven-turbo-2.5-tts': speechModel(
    { zh: 'Eleven Turbo 2.5', en: 'Eleven Turbo 2.5' },
    {
      kieElevenTurboVoice: voice,
      kieElevenTurboStability: { zh: '稳定度', en: 'Stability' },
      kieElevenTurboSpeed: speed,
    },
  ),
  'kie-eleven-v3-dialogue': speechModel(
    { zh: 'Eleven v3 对话语音', en: 'Eleven v3 Dialogue' },
    { kieElevenDialogueVoice: voice },
  ),
  'kie-gemini-3.1-flash-tts': speechModel(
    { zh: 'Gemini 3.1 Flash TTS', en: 'Gemini 3.1 Flash TTS' },
    {
      kieGeminiTtsVoice: voice,
      kieGeminiTtsScene: { zh: '场景描述', en: 'Scene' },
      kieGeminiTtsTemperature: { zh: '表现变化', en: 'Variation' },
    },
  ),
  'siliconflow-cosyvoice2-tts': speechModel(
    { zh: 'CosyVoice2', en: 'CosyVoice2' },
    { siliconflowCosyVoice: voice, siliconflowCosySpeed: speed, siliconflowCosyFormat: format },
  ),
  'siliconflow-moss-ttsd-0.5': speechModel(
    { zh: 'MOSS TTSD 0.5', en: 'MOSS TTSD 0.5' },
    { siliconflowMossVoice: voice, siliconflowMossFormat: format },
  ),
  'volcengine-seed-tts-2.0': speechModel(
    { zh: 'Seed-TTS 2.0', en: 'Seed-TTS 2.0' },
    { volcSeedTtsSpeaker: voice },
  ),
  'volcengine-seed-icl-2.0': speechModel(
    { zh: '豆包声音复刻 2.0', en: 'Doubao Voice Clone 2.0' },
    {
      volcIclMode: { zh: '模式', en: 'Mode' }, volcSeedIclSpeaker: voice,
      volcIclActivationConsent: { zh: '确认首次合成另收 138 元并锁定音色', en: 'Accept ¥138 first-use fee and voice lock' },
      volcCloneName: { zh: '音色名称', en: 'Voice name' },
      volcCloneAudio: { zh: '声音样本', en: 'Voice sample' },
      volcCloneLanguage: { zh: '录音语言', en: 'Recording language' },
      volcCloneTranscript: { zh: '录音原文（可选）', en: 'Transcript (optional)' },
      volcCloneDenoise: { zh: '去除背景噪声', en: 'Reduce background noise' },
      volcClonePreserveVolume: { zh: '保留原声音量', en: 'Preserve original volume' },
      volcCloneExistingSlot: { zh: '已有预付费音色（可选）', en: 'Existing prepaid voice (optional)' },
      volcCloneCustomId: { zh: '自定义音色代号', en: 'Custom voice identifier' },
    },
  ),
}

const cloneParams = ttsPresentation['volcengine-seed-icl-2.0'].params
ttsPresentation['volcengine-seed-icl-2.0'].paramPresentation = {
  groups: [{
    id: 'voice-clone-options', name: { zh: '更多克隆设置', en: 'More clone settings' }, order: 7, panelWidth: 460,
    sections: [
      { id: 'recording', name: { zh: '录音处理', en: 'Recording' }, paramIds: ['volcCloneTranscript', 'volcCloneDenoise', 'volcClonePreserveVolume'] },
      { id: 'existing', name: { zh: '使用已有音色', en: 'Reuse an existing voice' }, paramIds: ['volcCloneExistingSlot'] },
    ],
  }],
}
cloneParams.volcCloneAudio.uploadButtonText = { zh: '上传录音', en: 'Upload recording' }
cloneParams.volcIclMode.role = 'mode'
cloneParams.volcIclMode.optionLabels = { speech: { label: { zh: '语音合成', en: 'Text to speech' } }, clone: { label: { zh: '克隆声音', en: 'Clone voice' } } }
cloneParams.volcIclMode.tooltip = { zh: '克隆时，下方文本用于试听（4–300 字）。克隆完成后，切回语音合成即可在音色列表选用。训练试听按 3 元/万字符计费。', en: 'When cloning, use 4–300 characters below for the preview. The new voice appears in the voice list. Preview costs ¥3 per 10,000 characters.' }
cloneParams.volcCloneAudio.tooltip = { zh: '上传单人清晰说话的 WAV、MP3、OGG、M4A 或 AAC 文件，最大 10 MB。', en: 'Upload clear single-speaker audio: WAV, MP3, OGG, M4A or AAC, up to 10 MB.' }
cloneParams.volcCloneExistingSlot.tooltip = { zh: '留空自动新建后付费音色，无需填写 ID。已有预付费槽位可从火山控制台复制一次；重新训练会覆盖原效果。', en: 'Leave blank to create a pay-as-you-go voice automatically. To reuse a prepaid slot, enter its ID once. Retraining replaces its voice.' }
cloneParams.volcIclActivationConsent.tooltip = { zh: '仅播放克隆返回的试听不会激活音色。后付费音色首次正式合成会收取 138 元并锁定；7 天未正式使用会被火山删除。已激活音色不会重复收槽位费。', en: 'Playing the returned preview does not activate the voice. First synthesis costs ¥138 and locks it. Unused voices expire after 7 days. Activated voices are not charged again.' }
const cloneLanguages = ['中文', '英语', '日语', '西班牙语', '印尼语', '葡萄牙语', '德语', '法语', '韩语', '意大利语', '泰语', '越南语', '俄语', '菲律宾语', '马来语', '阿拉伯语', '墨西哥西班牙语', '巴西葡萄牙语', '', '波兰语', '土耳其语', '瑞典语']
const cloneLanguagesEn = ['Chinese', 'English', 'Japanese', 'Spanish', 'Indonesian', 'Portuguese', 'German', 'French', 'Korean', 'Italian', 'Thai', 'Vietnamese', 'Russian', 'Filipino', 'Malay', 'Arabic', 'Mexican Spanish', 'Brazilian Portuguese', '', 'Polish', 'Turkish', 'Swedish']
cloneParams.volcCloneLanguage.optionLabels = Object.fromEntries(cloneLanguages.flatMap((zh, index) => zh ? [[String(index), { label: { zh, en: cloneLanguagesEn[index] } }]] : []))

for (const [modelId, paramId] of [
  ['fal-minimax-speech-2.8', 'falMinimaxSpeechSpec'],
  ['bailian-minimax-speech-2.8', 'bailianMinimaxSpeechSpec'],
  ['bailian-cosyvoice-v3.5', 'bailianCosyVoiceSpec'],
]) ttsPresentation[modelId].params[paramId].role = 'mode'

for (const model of [ttsPresentation['fal-minimax-speech-2.8'], ttsPresentation['bailian-minimax-speech-2.8']]) {
  const id = Object.keys(model.params).find((key) => key.endsWith('Emotion'))!
  model.params[id].optionLabels = { '': { label: { zh: '自动', en: 'Auto' } } }
}

const ttsVoiceFields: Record<keyof typeof TTS_VOICE_SELECTORS, string> = {
  'fal-minimax-speech-2.8': 'falMinimaxSpeechVoice',
  'fal-eleven-v3-tts': 'falElevenV3Voice',
  'bailian-minimax-speech-2.8': 'bailianMinimaxSpeechVoice',
  'bailian-qwen-audio-3.1-tts-flash': 'bailianQwenTtsVoice',
  'bailian-cosyvoice-v3.5': 'bailianCosyVoiceId',
  'kie-eleven-turbo-2.5-tts': 'kieElevenTurboVoice',
  'kie-eleven-v3-dialogue': 'kieElevenDialogueVoice',
  'kie-gemini-3.1-flash-tts': 'kieGeminiTtsVoice',
  'siliconflow-cosyvoice2-tts': 'siliconflowCosyVoice',
  'siliconflow-moss-ttsd-0.5': 'siliconflowMossVoice',
  'volcengine-seed-tts-2.0': 'volcSeedTtsSpeaker',
  'volcengine-seed-icl-2.0': 'volcSeedIclSpeaker',
}

for (const [modelId, config] of Object.entries(TTS_VOICE_SELECTORS)) {
  const voiceParam = ttsPresentation[modelId].params[ttsVoiceFields[modelId]]
  voiceParam.panel = 'voice-selector'
  voiceParam.config = { ...config, width: 720 }
}
