/**
 * 音频内置效果的登记（任务 4.7c）：与视频内置效果同一套“意图量纲”与存储（`builtinEffects.ts`、片段效果链 `clip.effects`），
 * 只能加到声音片段上。每个参数写清范围、默认值、单位、给用户的悬停说明（`tooltip`）与给助手的语义说明（`description`）。
 * - 电平、均衡、音调这类方向取决于素材的效果默认中性（加上后不改变声音），由用户或助手按素材调整；
 *   降噪、压缩、限幅、去齿音、混响、高通、低通加上就能听到合理结果。
 * - 实现只有一份：剪辑混音里的确定性处理（`features/videoEdit/engine/videoEditAudioEffects.ts`），预览与导出同一路径。
 * 只用类型引用 `builtinEffects.ts`，避免两个登记文件互相引用值。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam } from './builtinEffects'

const number = (key: string, name: string, unit: 'strength' | 'decibels' | 'hertz' | 'semitones', range: [number, number, number], fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit, min: range[0], max: range[1], step: range[2], default: fallback, tooltip, description })
const strength = (key: string, name: string, fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => number(key, name, 'strength', [0, 100, 1], fallback, tooltip, description)
const band = (key: string, name: string, tooltip: string, description: string): VideoEditBuiltinParam => number(key, name, 'decibels', [-12, 12, 0.5], 0, tooltip, description)
const slope: VideoEditBuiltinParam = { key: 'slope', name: '坡度', type: 'enum', default: 'gentle', options: [{ value: 'gentle', label: '平缓' }, { value: 'steep', label: '陡峭' }], tooltip: '陡峭时截止频率外的声音去得更干净，平缓时过渡更自然', description: 'gentle（默认）每倍频程衰减 12 dB，过渡自然；steep 每倍频程 24 dB，截止频率外的声音去得更彻底。' }

export const VIDEO_EDIT_AUDIO_EFFECT_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = [
  { id: 'parametric_eq', name: '参数均衡', group: 'audio_eq', media: 'audio', tooltip: '调整低、中、高频的强弱，或一键套用“人声更清楚”“去低频嗡声”等预设', description: '三段均衡加常用预设：让人声更清楚、去掉电源嗡声、让声音更温暖或更明亮。预设与三段增益叠加；全部为 0 且无预设时声音不变。',
    params: [
      { key: 'preset', name: '预设', type: 'enum', default: 'none', options: [{ value: 'none', label: '无' }, { value: 'voice_clarity', label: '人声更清楚' }, { value: 'remove_hum', label: '去低频嗡声' }, { value: 'warm', label: '更温暖' }, { value: 'bright', label: '更明亮' }], tooltip: '一键套用常用的均衡曲线，下面三段可在此基础上再调', description: 'none（默认）只用下面三段；voice_clarity 切掉 80 Hz 以下低频、削弱 250 Hz 附近的浑浊感、提升 3 kHz 清晰度，适合对白与旁白；remove_hum 去掉 50/60 Hz 电源嗡声及其倍频并切掉 40 Hz 以下的低频隆隆声；warm 提升低频、略降高频，声音更厚更柔；bright 提升高频，声音更通透。' },
      band('low', '低频', '约 100 Hz 以下的低频：正值更浑厚，负值更干净', '低频搁架（约 100 Hz 以下）增益，单位 dB：-12 明显削薄，0（默认）不变，+6 明显更厚重。'),
      band('mid', '中频', '约 1 kHz 的中频（人声主体）：正值更突出靠前，负值更空', '中频（约 1 kHz，人声主体）增益，单位 dB：负值让声音更“空”、靠后，正值更突出、靠前；0（默认）不变。'),
      band('high', '高频', '约 8 kHz 以上的高频：正值更明亮，负值更闷', '高频搁架（约 8 kHz 以上）增益，单位 dB：+3 更明亮通透，-6 更闷、可压掉嘶声；0（默认）不变。'),
    ] },
  { id: 'high_pass', name: '高通（去低频）', group: 'audio_eq', media: 'audio', tooltip: '去掉低于截止频率的低频，如风噪、脚步、空调隆隆声', description: '去掉截止频率以下的低频：人声常用 80 Hz（默认）去掉风噪、喷麦、桌面震动；120–150 Hz 更干净但声音变薄。',
    params: [number('frequency', '截止频率', 'hertz', [20, 1000, 1], 80, '低于这个频率的声音被去掉', '截止频率 Hz：40 只去极低的隆隆声；80（默认）适合大多数人声；150 以上声音明显变薄（电话感）。'), slope] },
  { id: 'low_pass', name: '低通（去高频）', group: 'audio_eq', media: 'audio', tooltip: '去掉高于截止频率的高频，如嘶声；也可做隔墙、电话的闷声效果', description: '去掉截止频率以上的高频：8000 Hz（默认）压掉嘶声与刺耳高频；3000 Hz 以下是隔墙、水下、老收音机般的闷声效果。',
    params: [number('frequency', '截止频率', 'hertz', [500, 20000, 10], 8000, '高于这个频率的声音被去掉', '截止频率 Hz：12000 只压掉最刺的高频；8000（默认）明显去嘶声；3000 隔墙或电话感；1000 很闷，像在水下。'), slope] },
  { id: 'compressor', name: '压缩器', group: 'audio_dynamics', media: 'audio', tooltip: '压低大声、相对抬高小声，让音量更平稳', description: '动态压缩：把超过阈值的大声压下来并自动补回整体音量，让对白忽大忽小变得平稳、更“靠前”。',
    params: [
      strength('amount', '压缩量', 40, '压缩程度，0 不压缩', '0 不压缩；20 ≈ 轻微平滑；40（默认）≈ 对白常用的平稳感；70 ≈ 明显的广播感；100 ≈ 很重的压缩（阈值约 -40 dB、比率约 8:1）。'),
      { key: 'speed', name: '响应速度', type: 'enum', default: 'normal', options: [{ value: 'fast', label: '快' }, { value: 'normal', label: '中' }, { value: 'slow', label: '慢' }], tooltip: '多快压下突然变大的声音、多快恢复', description: 'fast 很快压住爆音与重音，但可能有喘息感；normal（默认）适合对白；slow 动作温和，适合音乐与环境声。' },
      { key: 'makeup', name: '自动补偿音量', type: 'boolean', default: true, tooltip: '压缩后自动把整体音量补回来', description: 'true（默认）按压缩量自动提升整体音量（压缩后不会变轻）；false 只压低大声，整体会变轻。' },
    ] },
  { id: 'limiter', name: '限幅器', group: 'audio_dynamics', media: 'audio', tooltip: '保证声音不超过设定的最大电平，防止爆音削波', description: '硬限幅：声音峰值永远不超过“最大电平”，提前约 5 毫秒预判并平滑压下，防止导出后爆音削波；可先提升输入增益让整体更响。片段音量在效果之前生效，淡化与过渡只会让声音更轻。',
    params: [
      number('ceiling', '最大电平', 'decibels', [-12, 0, 0.1], -1, '输出峰值的上限', '输出峰值上限 dBFS：-1（默认）常用于成片；-3 留更多余量；0 贴满。'),
      number('boost', '输入增益', 'decibels', [0, 12, 0.5], 0, '先把声音整体提升多少再限幅', '限幅前先提升的音量 dB：0（默认）只防削波；+6 整体明显更响（峰值仍不超过最大电平）。'),
    ] },
  { id: 'de_esser', name: '去齿音', group: 'audio_dynamics', media: 'audio', tooltip: '压低“嘶”“次”等刺耳的齿音', description: '只在齿音出现时压低高频（s、sh、c、z 等刺耳的嘶声），其余时间不影响音色。用于近距离录制的人声。',
    params: [
      strength('amount', '强度', 50, '齿音被压低的程度', '0 不处理；30 ≈ 轻微；50（默认）≈ 明显减轻齿音；100 ≈ 很强，可能让人声发闷（最多压低约 18 dB）。'),
      number('frequency', '起始频率', 'hertz', [3000, 10000, 100], 6000, '从多高的频率开始算作齿音', '齿音所在频段的下限 Hz：女声、童声常在 6000–8000，男声在 4000–6000；6000（默认）。'),
    ] },
  { id: 'noise_reduction', name: '降噪', group: 'audio_repair', media: 'audio', tooltip: '去掉人声里的背景噪声，如风扇、空调、电流底噪', description: '基于 RNNoise 神经网络的人声降噪：保留说话声，去掉稳定或变化的背景噪声（风扇、空调、键盘、街道）。只适合人声，不适合音乐。',
    params: [strength('strength', '降噪强度', 80, '噪声被去掉的程度', '0 不降噪；50 ≈ 噪声减半（约 -6 dB）；80（默认）≈ 噪声明显降低（约 -14 dB）、人声自然；100 完全交给降噪模型，最干净但人声可能略显单薄。')] },
  { id: 'reverb', name: '混响', group: 'audio_space', media: 'audio', tooltip: '加入房间或大厅的空间感', description: '模拟房间反射（Freeverb 算法）：让干涩的录音有空间感，或营造大厅、回忆、梦境氛围。',
    params: [
      strength('room_size', '空间大小', 50, '房间有多大，越大余音越长', '0 很小的房间（余音很短）；50（默认）中等房间；80 大厅；100 非常长的余音。'),
      strength('damping', '高频衰减', 50, '余音里高频消失得多快，越大越闷', '0 余音明亮（瓷砖浴室）；50（默认）自然；100 很闷（铺满软装的房间）。'),
      strength('mix', '混响量', 25, '混响声相对原声的多少', '0 只有原声；15 ≈ 轻微空间感；25（默认）≈ 明显房间感；60 以上原声被淹没，像在远处。'),
    ] },
  { id: 'pitch_shift', name: '音调变换', group: 'audio_space', media: 'audio', tooltip: '升高或降低音调，速度不变', description: '在不改变速度与时长的情况下升降音调（相位声码器）：+12 高一个八度（卡通、小黄人感），-5 声音低沉，-12 低一个八度（怪物感）；±1 以内可微调人声。',
    params: [number('semitones', '变调', 'semitones', [-12, 12, 0.5], 0, '正值升高音调，负值降低，单位为半音', '音调偏移的半音数：0（默认）不变；+12 高一个八度；-12 低一个八度；+3/-3 ≈ 明显但仍自然。')] },
  { id: 'gain_balance', name: '增益与声道平衡', group: 'audio_level', media: 'audio', tooltip: '整体放大或减小音量，调整左右声道的平衡', description: '按 dB 调整音量（可超过片段音量的上限），调整左右声道平衡，或把左右声道合成单声道（修正只有一边有声音的录音）。',
    params: [
      number('gain', '增益', 'decibels', [-24, 24, 0.5], 0, '正值放大，负值减小', '音量增益 dB：+6 ≈ 响一倍的感觉，-6 ≈ 一半，0（默认）不变。'),
      { key: 'balance', name: '声道平衡', type: 'number', unit: 'strength', min: -100, max: 100, step: 1, default: 0, tooltip: '负值偏左，正值偏右', description: '-100 只剩左声道，0（默认）不变，+100 只剩右声道；序列为单声道时不起作用。' },
      { key: 'mono', name: '合成单声道', type: 'boolean', default: false, tooltip: '把左右声道混在一起，两边听到相同的声音', description: 'true 把左右声道平均成同一个声音（修正只有一边有声音的录音）；false（默认）保持立体声。' },
    ] },
]
