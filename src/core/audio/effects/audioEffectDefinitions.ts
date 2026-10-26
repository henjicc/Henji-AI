/**
 * 音频内置效果的登记（任务 4.7c）：与视频内置效果同一套“意图量纲”与存储（`builtinEffects.ts`、片段效果链 `clip.effects`），
 * 只能加到声音片段上。每个参数写清范围、默认值、单位、给用户的悬停说明（`tooltip`）与给助手的语义说明（`description`）。
 * - 分组与顺序参照 Adobe Audition 的效果菜单：振幅与声道、动态与压限、延迟与回声、滤波与均衡、调制、降噪与修复、混响与空间、
 *   特殊效果、立体声、时间与变调（同组的效果排在一起，效果库按组列出）。
 * - 电平、均衡、延迟、立体声、音调这类方向取决于素材的效果默认中性（加上后不改变声音），由用户或助手按素材调整；
 *   降噪、去嗡声、压缩、限幅、噪声门、语音电平、去齿音、回声、混响、调制、扭曲、人声增强、高通、低通、陷波加上就能听到合理结果。
 * - 实现只有一份：`audioEffectChain.ts` 的确定性逐样本处理（处理器在 `processors/`），剪辑混音与音频编辑共用，预览与导出同一路径。
 * 只用类型引用 `builtinEffects.ts`，避免两个登记文件互相引用值。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam } from '../../videoEdit/builtinEffects'

type AudioUnit = 'strength' | 'decibels' | 'hertz' | 'semitones' | 'milliseconds' | 'value'
const number = (key: string, name: string, unit: AudioUnit, range: [number, number, number], fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit, min: range[0], max: range[1], step: range[2], default: fallback, tooltip, description })
const strength = (key: string, name: string, fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => number(key, name, 'strength', [0, 100, 1], fallback, tooltip, description)
const band = (key: string, name: string, tooltip: string, description: string): VideoEditBuiltinParam => number(key, name, 'decibels', [-12, 12, 0.5], 0, tooltip, description)
const toggle = (key: string, name: string, tooltip: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'boolean', default: false, tooltip, description })
const choice = (key: string, name: string, fallback: string, options: ReadonlyArray<readonly [string, string]>, tooltip: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'enum', default: fallback, options: options.map(([value, label]) => ({ value, label })), tooltip, description })
const slope: VideoEditBuiltinParam = { key: 'slope', name: '坡度', type: 'enum', default: 'gentle', options: [{ value: 'gentle', label: '平缓' }, { value: 'steep', label: '陡峭' }], tooltip: '陡峭时截止频率外的声音去得更干净，平缓时过渡更自然', description: 'gentle（默认）每倍频程衰减 12 dB，过渡自然；steep 每倍频程 24 dB，截止频率外的声音去得更彻底。' }
const mix = (fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => strength('mix', '混合量', fallback, tooltip, description)
const feedback = (fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => number('feedback', '反馈', 'strength', [0, 95, 1], fallback, tooltip, description)
const modulationRate = (fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => number('rate', '速度', 'hertz', [0.05, 5, 0.01], fallback, tooltip, description)
/** 参数均衡器的一个峰值段：增益、中心频率、窄度。 */
const peakBand = (index: number, frequency: number, hint: string): VideoEditBuiltinParam[] => [
  number(`band${index}_gain`, `频段 ${index} 增益`, 'decibels', [-15, 15, 0.5], 0, '这个频段的提升或衰减', `峰值段 ${index} 的增益 dB：正值提升、负值衰减；0（默认）不变。`),
  number(`band${index}_frequency`, `频段 ${index} 频率`, 'hertz', [40, 16000, 1], frequency, '这个频段的中心频率', `峰值段 ${index} 的中心频率 Hz，默认 ${frequency}（${hint}）。250 附近是浑浊感，1000 附近是人声主体，3000–5000 是存在感与清晰度。`),
  strength(`band${index}_q`, `频段 ${index} 窄度`, 30, '数值越大，影响的频率范围越窄', `峰值段 ${index} 的窄度，换算为 Q = 0.3 + 7.7 ×（窄度/100）²：0 ≈ Q 0.3（很宽，约 4 个倍频程）；30（默认）≈ Q 1（约 1.4 个倍频程）；50 ≈ Q 2.2；100 = Q 8（很窄，适合精确切掉一个共振）。`),
]
/** 三段压缩器的一段压缩量。 */
const bandAmount = (key: string, name: string, range: string, timing: string): VideoEditBuiltinParam => strength(key, name, 30, `${range}的压缩程度，0 不压缩`, `与“压缩器”的压缩量同一标尺：0 不压缩；30（默认）≈ 阈值 -12 dB、比率 3.1:1 的轻度收紧；70 ≈ 明显的广播感；100 很重。压缩后自动补偿音量。${timing}`)

export const AUDIO_EFFECT_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = [
  // —— 振幅与声道 ——
  { id: 'gain_balance', name: '增益与声道平衡', group: 'audio_level', media: 'audio', tooltip: '整体放大或减小音量，调整左右声道的平衡', description: '按 dB 调整音量（可超过片段音量的上限），调整左右声道平衡，或把左右声道合成单声道（修正只有一边有声音的录音）。',
    params: [
      number('gain', '增益', 'decibels', [-24, 24, 0.5], 0, '正值放大，负值减小', '音量增益 dB：+6 ≈ 响一倍的感觉，-6 ≈ 一半，0（默认）不变。'),
      { key: 'balance', name: '声道平衡', type: 'number', unit: 'strength', min: -100, max: 100, step: 1, default: 0, tooltip: '负值偏左，正值偏右', description: '-100 只剩左声道，0（默认）不变，+100 只剩右声道；序列为单声道时不起作用。' },
      { key: 'mono', name: '合成单声道', type: 'boolean', default: false, tooltip: '把左右声道混在一起，两边听到相同的声音', description: 'true 把左右声道平均成同一个声音（修正只有一边有声音的录音）；false（默认）保持立体声。' },
    ] },
  // —— 动态与压限 ——
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
  // —— 滤波与均衡 ——
  { id: 'parametric_eq', name: '参数均衡', group: 'audio_eq', media: 'audio', tooltip: '调整低、中、高频的强弱，或一键套用“人声更清楚”“去低频嗡声”等预设', description: '三段均衡加常用预设：让人声更清楚、去掉电源嗡声、让声音更温暖或更明亮。预设与三段增益叠加；全部为 0 且无预设时声音不变。',
    params: [
      { key: 'preset', name: '预设', type: 'enum', default: 'none', options: [{ value: 'none', label: '无' }, { value: 'voice_clarity', label: '人声更清楚' }, { value: 'remove_hum', label: '去低频嗡声' }, { value: 'warm', label: '更温暖' }, { value: 'bright', label: '更明亮' }], tooltip: '一键套用常用的均衡曲线，下面三段可在此基础上再调', description: 'none（默认）只用下面三段；voice_clarity 切掉 80 Hz 以下低频、削弱 250 Hz 附近的浑浊感、提升 3 kHz 清晰度，适合对白与旁白；remove_hum 去掉 50/60 Hz 电源嗡声及其倍频并切掉 40 Hz 以下的低频隆隆声；warm 提升低频、略降高频，声音更厚更柔；bright 提升高频，声音更通透。' },
      band('low', '低频', '约 100 Hz 以下的低频：正值更浑厚，负值更干净', '低频搁架（约 100 Hz 以下）增益，单位 dB：-12 明显削薄，0（默认）不变，+6 明显更厚重。'),
      band('mid', '中频', '约 1 kHz 的中频（人声主体）：正值更突出靠前，负值更空', '中频（约 1 kHz，人声主体）增益，单位 dB：负值让声音更“空”、靠后，正值更突出、靠前；0（默认）不变。'),
      band('high', '高频', '约 8 kHz 以上的高频：正值更明亮，负值更闷', '高频搁架（约 8 kHz 以上）增益，单位 dB：+3 更明亮通透，-6 更闷、可压掉嘶声；0（默认）不变。'),
    ] },
  { id: 'eq_bands', name: '参数均衡器', group: 'audio_eq', media: 'audio', tooltip: '高低通、低高频搁架加三个可调频率与窄度的峰值段，精细修整音色', description: '多段参数均衡，比“参数均衡”更精细：可开关的高通与低通（每倍频程 12 dB）、低频与高频搁架、三个可调频率与窄度的峰值段。全部增益为 0 且高通、低通关闭时声音不变。',
    params: [
      toggle('hp_on', '高通', '打开后去掉高通频率以下的低频', 'true 打开高通（每倍频程 12 dB），去掉 hp_frequency 以下的低频；false（默认）关闭。'),
      number('hp_frequency', '高通频率', 'hertz', [20, 1000, 1], 80, '高通打开时，低于这个频率的声音被去掉', '高通截止频率 Hz（hp_on 为 true 时生效）：80（默认）适合大多数人声；120–150 更干净但变薄。'),
      number('low_gain', '低频增益', 'decibels', [-15, 15, 0.5], 0, '低频搁架：低于低频频率的声音整体提升或衰减', '低频搁架增益 dB：正值更厚重，负值更干净；0（默认）不变。'),
      number('low_frequency', '低频频率', 'hertz', [20, 1000, 1], 120, '低频搁架作用的转折频率', '低频搁架的转折频率 Hz：120（默认）；越高影响的范围越大。'),
      ...peakBand(1, 250, '浑浊感'), ...peakBand(2, 1000, '人声主体'), ...peakBand(3, 4000, '存在感'),
      number('high_gain', '高频增益', 'decibels', [-15, 15, 0.5], 0, '高频搁架：高于高频频率的声音整体提升或衰减', '高频搁架增益 dB：正值更明亮，负值更闷、压掉嘶声；0（默认）不变。'),
      number('high_frequency', '高频频率', 'hertz', [1000, 20000, 10], 8000, '高频搁架作用的转折频率', '高频搁架的转折频率 Hz：8000（默认）；越低影响的范围越大。'),
      toggle('lp_on', '低通', '打开后去掉低通频率以上的高频', 'true 打开低通（每倍频程 12 dB），去掉 lp_frequency 以上的高频；false（默认）关闭。'),
      number('lp_frequency', '低通频率', 'hertz', [1000, 20000, 10], 16000, '低通打开时，高于这个频率的声音被去掉', '低通截止频率 Hz（lp_on 为 true 时生效）：16000（默认）只压掉最高频的嘶声；8000 明显去嘶声；3000 电话感。'),
    ] },
  { id: 'graphic_eq', name: '图形均衡器（10 段）', group: 'audio_eq', media: 'audio', tooltip: '按 31 Hz 到 16 kHz 的 10 个固定频段分别提升或衰减', description: '10 段倍频程图形均衡：每段是 Q≈1.41（一个倍频程宽）的峰值滤波器，中心 31、63、125、250、500 Hz 与 1、2、4、8、16 kHz，直观地按频段调整音色。全部为 0 时声音不变。',
    params: [
      band('band_31', '31 Hz', '31 Hz 附近：超低频的震动与隆隆声', '中心 31 Hz（超低频）的增益 dB：负值去掉隆隆声与震动，正值增加下潜感；人声通常不需要。0（默认）不变。'),
      band('band_63', '63 Hz', '63 Hz 附近：低音的力度', '中心 63 Hz（低音）的增益 dB：正值低音更有力，负值减轻轰鸣；0（默认）不变。'),
      band('band_125', '125 Hz', '125 Hz 附近：声音的厚度', '中心 125 Hz 的增益 dB：男声的胸腔共鸣所在，正值更厚实，负值更干净；0（默认）不变。'),
      band('band_250', '250 Hz', '250 Hz 附近：浑浊感', '中心 250 Hz 的增益 dB：声音发闷、发浑时常在这里衰减 -2 到 -4；0（默认）不变。'),
      band('band_500', '500 Hz', '500 Hz 附近：闷罐、箱体感', '中心 500 Hz 的增益 dB：负值减轻闷罐、箱体感，正值更饱满；0（默认）不变。'),
      band('band_1k', '1 kHz', '1 kHz 附近：人声主体', '中心 1 kHz 的增益 dB：正值人声更靠前，过多会有鼻音、电话感；0（默认）不变。'),
      band('band_2k', '2 kHz', '2 kHz 附近：咬字清晰度', '中心 2 kHz 的增益 dB：正值咬字更清楚，过多显得生硬；0（默认）不变。'),
      band('band_4k', '4 kHz', '4 kHz 附近：存在感', '中心 4 kHz 的增益 dB：+2 到 +4 让人声更有存在感、更“透”，过多刺耳；0（默认）不变。'),
      band('band_8k', '8 kHz', '8 kHz 附近：明亮度与齿音', '中心 8 kHz 的增益 dB：正值更明亮，负值减轻齿音与嘶声；0（默认）不变。'),
      band('band_16k', '16 kHz', '16 kHz 附近：空气感', '中心 16 kHz 的增益 dB：正值增加空气感与通透，负值压掉最高频的嘶声；0（默认）不变。'),
      band('output', '输出增益', '均衡之后整体放大或减小音量', '均衡之后的整体音量 dB：多段提升后声音变响时用负值拉回；0（默认）不变。'),
    ] },
  { id: 'notch', name: '陷波滤波器', group: 'audio_eq', media: 'audio', tooltip: '精确压掉一个频率的声音，如啸叫、单频干扰、共振', description: '在指定频率挖一个窄凹口：去掉啸叫、单频干扰或房间共振，其他频率几乎不受影响。去电源嗡声用“去除嗡嗡声”。',
    params: [
      number('frequency', '频率', 'hertz', [20, 20000, 1], 1000, '要压掉的频率', '凹口的中心频率 Hz：设成干扰声的频率（如 1000 Hz 的测试音、某个啸叫点）；1000（默认）。'),
      strength('width', '宽度', 50, '凹口有多宽，越大影响的频率范围越宽', '凹口宽度，换算为 Q = 30 ×（1/30）^(宽度/100)，-3 dB 处的带宽 ≈ 频率 / Q：0 = Q 30（极窄，1 kHz 处约 33 Hz 宽）；50（默认）≈ Q 5.5（约 180 Hz 宽）；100 = Q 1（很宽，与中心频率同宽）。'),
      number('depth', '深度', 'decibels', [-60, 0, 1], -30, '中心频率被压低多少', '凹口中心的衰减 dB：-30（默认）明显压掉；-60 几乎完全去除；0 不处理。'),
    ] },
  { id: 'high_pass', name: '高通（去低频）', group: 'audio_eq', media: 'audio', tooltip: '去掉低于截止频率的低频，如风噪、脚步、空调隆隆声', description: '去掉截止频率以下的低频：人声常用 80 Hz（默认）去掉风噪、喷麦、桌面震动；120–150 Hz 更干净但声音变薄。',
    params: [number('frequency', '截止频率', 'hertz', [20, 1000, 1], 80, '低于这个频率的声音被去掉', '截止频率 Hz：40 只去极低的隆隆声；80（默认）适合大多数人声；150 以上声音明显变薄（电话感）。'), slope] },
  { id: 'low_pass', name: '低通（去高频）', group: 'audio_eq', media: 'audio', tooltip: '去掉高于截止频率的高频，如嘶声；也可做隔墙、电话的闷声效果', description: '去掉截止频率以上的高频：8000 Hz（默认）压掉嘶声与刺耳高频；3000 Hz 以下是隔墙、水下、老收音机般的闷声效果。',
    params: [number('frequency', '截止频率', 'hertz', [500, 20000, 10], 8000, '高于这个频率的声音被去掉', '截止频率 Hz：12000 只压掉最刺的高频；8000（默认）明显去嘶声；3000 隔墙或电话感；1000 很闷，像在水下。'), slope] },
  // —— 降噪与修复 ——
  { id: 'noise_reduction', name: '降噪', group: 'audio_repair', media: 'audio', tooltip: '去掉人声里的背景噪声，如风扇、空调、电流底噪', description: '基于 RNNoise 神经网络的人声降噪：保留说话声，去掉稳定或变化的背景噪声（风扇、空调、键盘、街道）。只适合人声，不适合音乐。',
    params: [strength('strength', '降噪强度', 80, '噪声被去掉的程度', '0 不降噪；50 ≈ 噪声减半（约 -6 dB）；80（默认）≈ 噪声明显降低（约 -14 dB）、人声自然；100 完全交给降噪模型，最干净但人声可能略显单薄。')] },
  { id: 'dehum', name: '去除嗡嗡声', group: 'audio_repair', media: 'audio', tooltip: '去掉电源干扰带来的 50/60 Hz 嗡声及其倍频', description: '去掉电源嗡声：在基频（国内 50 Hz）及其倍频上各挖一个窄凹口，并用四阶高通切掉 30 Hz 以下的直流与次低频。人声与音乐的其他部分几乎不受影响。',
    params: [
      choice('mains', '电源频率', '50', [['50', '50 Hz（国内）'], ['60', '60 Hz']], '嗡声的基频：国内、欧洲为 50 Hz，北美等地为 60 Hz', '50（默认）中国大陆、欧洲等地的电网；60 北美、日本西部等地。'),
      number('harmonics', '谐波数', 'value', [1, 10, 1], 5, '去掉基频及多少个倍频', '处理的频率个数（含基频）：1 只去基频；5（默认）去 50–250 Hz；10 去到 500 Hz（嗡声发“毛”、带蜂鸣时用）。'),
      strength('amount', '强度', 80, '凹口的深度与宽度，越大去得越干净', '深度 = -0.6 × 强度 dB，Q = 30 - 0.2 × 强度（-3 dB 处带宽 ≈ 频率 / Q）：0 不去嗡声（只保留 30 Hz 高通）；80（默认）每个凹口约 -48 dB、Q 14（50 Hz 处约 3.6 Hz 宽）；100 约 -60 dB、Q 10（更深更宽，容得下电源频率的小漂移）。'),
    ] },
  // —— 混响与空间 ——
  { id: 'reverb', name: '混响', group: 'audio_space', media: 'audio', tooltip: '加入房间或大厅的空间感', description: '模拟房间反射（Freeverb 算法）：让干涩的录音有空间感，或营造大厅、回忆、梦境氛围。',
    params: [
      strength('room_size', '空间大小', 50, '房间有多大，越大余音越长', '0 很小的房间（余音很短）；50（默认）中等房间；80 大厅；100 非常长的余音。'),
      strength('damping', '高频衰减', 50, '余音里高频消失得多快，越大越闷', '0 余音明亮（瓷砖浴室）；50（默认）自然；100 很闷（铺满软装的房间）。'),
      strength('mix', '混响量', 25, '混响声相对原声的多少', '0 只有原声；15 ≈ 轻微空间感；25（默认）≈ 明显房间感；60 以上原声被淹没，像在远处。'),
    ] },
  // —— 时间与变调 ——
  { id: 'pitch_shift', name: '音调变换', group: 'audio_pitch', media: 'audio', tooltip: '升高或降低音调，速度不变', description: '在不改变速度与时长的情况下升降音调（相位声码器）：+12 高一个八度（卡通、小黄人感），-5 声音低沉，-12 低一个八度（怪物感）；±1 以内可微调人声。',
    params: [number('semitones', '变调', 'semitones', [-12, 12, 0.5], 0, '正值升高音调，负值降低，单位为半音', '音调偏移的半音数：0（默认）不变；+12 高一个八度；-12 低一个八度；+3/-3 ≈ 明显但仍自然。')] },
]
