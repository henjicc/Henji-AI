/**
 * 音频内置效果的登记：与视频内置效果同一套“意图量纲”与存储（`builtinEffects.ts`、片段效果链 `clip.effects`），
 * 只能加到声音片段上。每个参数写清范围、默认值、单位与说明（`description`，悬停与助手读同一句）；尚未改写成一份说明的效果另有界面短句（`tooltip`）。
 * - 分组与顺序参照 Adobe Audition 的效果菜单：振幅与声道、动态与压限、延迟与回声、滤波与均衡、调制、降噪与修复、混响与空间、
 *   特殊效果、立体声、时间与变调（同组的效果排在一起，效果库按组列出）。
 * - 电平、均衡、延迟、立体声、音调这类方向取决于素材的效果默认中性（加上后不改变声音），由用户或助手按素材调整；
 *   降噪、去嗡声、压缩、限幅、噪声门、语音电平、去齿音、回声、混响、调制、扭曲、人声增强、高通、低通、陷波加上就能听到合理结果。
 * - 实现只有一份：`audioEffectChain.ts` 的确定性逐样本处理（处理器在 `processors/`），剪辑混音与音频编辑共用，预览与导出同一路径。
 * 只用类型引用 `builtinEffects.ts`，避免两个登记文件互相引用值。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam } from '../../videoEdit/builtinEffects'

type AudioUnit = 'strength' | 'decibels' | 'hertz' | 'semitones' | 'milliseconds' | 'value'
/** `tooltip` 传 undefined 的参数只有一份说明：悬停提示与助手读同一句。 */
const said = (tooltip: string | undefined, description: string): Pick<VideoEditBuiltinParam, 'tooltip' | 'description'> => tooltip === undefined ? { description } : { tooltip, description }
const number = (key: string, name: string, unit: AudioUnit, range: [number, number, number], fallback: number, tooltip: string | undefined, description: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit, min: range[0], max: range[1], step: range[2], default: fallback, ...said(tooltip, description) })
const strength = (key: string, name: string, fallback: number, tooltip: string | undefined, description: string): VideoEditBuiltinParam => number(key, name, 'strength', [0, 100, 1], fallback, tooltip, description)
const band = (key: string, name: string, tooltip: string | undefined, description: string): VideoEditBuiltinParam => number(key, name, 'decibels', [-12, 12, 0.5], 0, tooltip, description)
const toggle = (key: string, name: string, tooltip: string | undefined, description: string): VideoEditBuiltinParam => ({ key, name, type: 'boolean', default: false, ...said(tooltip, description) })
const choice = (key: string, name: string, fallback: string, options: ReadonlyArray<readonly [string, string]>, tooltip: string | undefined, description: string): VideoEditBuiltinParam => ({ key, name, type: 'enum', ...(key === 'mode' ? { animatable: false } : {}), default: fallback, options: options.map(([value, label]) => ({ value, label })), ...said(tooltip, description) })
const slope: VideoEditBuiltinParam = { key: 'slope', name: '坡度', type: 'enum', default: 'gentle', options: [{ value: 'gentle', label: '平缓' }, { value: 'steep', label: '陡峭' }], description: '截止频率外的声音去得多干净。平缓（默认）过渡自然；陡峭去得更彻底。' }
const mix = (fallback: number, tooltip: string | undefined, description: string): VideoEditBuiltinParam => strength('mix', '混合量', fallback, tooltip, description)
const feedback = (fallback: number, tooltip: string | undefined, description: string): VideoEditBuiltinParam => number('feedback', '反馈', 'strength', [0, 95, 1], fallback, tooltip, description)
const modulationRate = (fallback: number, tooltip: string | undefined, description: string): VideoEditBuiltinParam => number('rate', '速度', 'hertz', [0.05, 5, 0.01], fallback, tooltip, description)
/** 均衡器参数方式的一个峰值段：增益、中心频率、窄度。 */
const peakBand = (index: number, frequency: number, hint: string): VideoEditBuiltinParam[] => [
  number(`band${index}_gain`, `频段 ${index} 增益`, 'decibels', [-15, 15, 0.5], 0, undefined, '这一段频率变强还是变弱。0（默认）不变；发闷、发浑的地方减 2–4 dB，想突出的地方往上加。'),
  number(`band${index}_frequency`, `频段 ${index} 频率`, 'hertz', [40, 16000, 1], frequency, undefined, `这一段在什么音高，默认 ${frequency} Hz（${hint}）。250 Hz 附近是浑浊感，1000 Hz 附近是人声主体，3000–5000 Hz 是存在感和清晰度。`),
  strength(`band${index}_q`, `频段 ${index} 窄度`, 30, undefined, '这一段管多宽的范围。0 很宽，整体染色；30（默认）适中；100 很窄，适合精确切掉一个共振或啸叫。'),
]
/** 多段压缩的一段压缩量。 */
const bandAmount = (key: string, name: string, what: string): VideoEditBuiltinParam => strength(key, name, 30, undefined, `${what}0 不压；30（默认）轻度收紧；70 明显的广播感；100 很重。压完自动补回音量。`)

/** 同一方式的参数保留各自量纲与默认值，前缀隔开不同算法的同名键。 */
const modeParams = (params: readonly VideoEditBuiltinParam[], mode: string, prefix = ''): VideoEditBuiltinParam[] => params.map(param => ({ ...param, key: prefix + param.key, visibleWhen: prefix === 'simple_' || mode === 'parametric' ? { param: 'mode', in: [mode, 'combined'] } : { param: 'mode', equals: mode } }))

export const AUDIO_EFFECT_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = [
  { id: 'gain_balance', name: '增益与声道', group: 'audio_level', media: 'audio', description: '调整音量和左右声道：放大或减小音量、让声音偏左或偏右、把左右合成单声道，或把某个声道反相。音量不够、只有一边有声音，或两支麦克风叠在一起发空、变薄时用。',
    params: [
      number('gain', '增益', 'decibels', [-24, 24, 0.5], 0, undefined, '整体音量变大还是变小。0（默认）不变；+6 dB 明显更响；-6 dB 明显更轻。可以超过片段音量的上限。'),
      { key: 'balance', name: '声道平衡', type: 'number', unit: 'strength', min: -100, max: 100, step: 1, default: 0, description: '声音偏向左边还是右边。0（默认）不变；-100 只剩左声道；+100 只剩右声道。序列是单声道时不起作用。' },
      { key: 'mono', name: '合成单声道', type: 'boolean', default: false, description: '把左右声道混成同一个声音，两边听到的一样。只有一边有声音的录音打开它；默认关闭，保持立体声。' },
      choice('invert', '反相', 'none', [['none', '关闭'], ['both', '左右声道'], ['left', '仅左声道'], ['right', '仅右声道']], undefined, '把选中声道的波形上下翻转，单独听没有区别。两支麦克风或左右声道叠在一起发空、变薄时，翻转其中一路就能修好。默认关闭。'),
    ] },
  { id: 'stereo_width', name: '立体声扩展', group: 'audio_level', media: 'audio', tooltip: '让立体声更宽或更窄，调整中间声音的大小', description: '中侧（M/S）处理：宽度调侧声道（左右的差异），中置调中声道（左右共有的部分，通常是人声与主奏）。宽度 100、中置 0 时声音不变；序列为单声道时不起作用。',
    params: [
      number('width', '宽度', 'strength', [0, 200, 1], 100, '0 变成单声道，100 不变，200 最宽', '侧声道比例：0 完全单声道；50 收窄一半；100（默认）不变；150 明显加宽；200 侧声道加倍（可能显得空，单声道播放时会丢失部分声音）。'),
      number('center', '中置', 'decibels', [-12, 12, 0.5], 0, '左右共有的声音（通常是人声）提升或衰减', '中声道增益 dB：+3 人声更突出；-6 人声后退（做伴奏感）；0（默认）不变。'),
    ] },
  { id: 'compressor', name: '压缩器', group: 'audio_dynamics', media: 'audio', description: '把太响的地方压下来，再把整体音量补回去，让忽大忽小的声音变平稳、更靠前。单段整体一起压，适合对白；多段把低、中、高频分开压，低频稳、高频不刺耳，音色更自然，适合人声后期和配乐整体收紧。',
    params: [
      choice('mode', '方式', 'single', [['single', '单段'], ['multi', '多段']], undefined, '整体一起压，还是分低、中、高三段各压各的。单段（默认）简单直接，适合对白；多段音色更自然，低频不发虚、高频不刺耳。'),
      ...modeParams([
      strength('amount', '压缩量', 40, undefined, '压得多重。0 不压缩；20 轻微平滑；40（默认）对白常用的平稳感；70 明显的广播感；100 很重。'),
      { key: 'speed', name: '响应速度', type: 'enum', default: 'normal', options: [{ value: 'fast', label: '快' }, { value: 'normal', label: '中' }, { value: 'slow', label: '慢' }], description: '声音突然变响时多快压下去、之后多快放开。快 压得住爆音和重音，但可能有喘息感；中（默认）适合对白；慢 更温和，适合音乐和环境声。' },
      { key: 'makeup', name: '自动补偿音量', type: 'boolean', default: true, description: '压完后自动把整体音量补回来，声音不会变轻。默认打开；关掉只压低响的地方，整体会变轻。' },
    ], 'single', ''),
      ...modeParams([
      number('low_crossover', '低/中分频点', 'hertz', [60, 1000, 1], 200, undefined, '多低的声音归低频段。200 Hz（默认）把人声的厚度分进低频；只想单独压住轰鸣时设 120 Hz。'),
      number('high_crossover', '中/高分频点', 'hertz', [1000, 10000, 10], 3000, undefined, '多高的声音归高频段。3000 Hz（默认）；只想压住齿音和刺耳感时设 5000 Hz。'),
      bandAmount('low_amount', '低频压缩量', '低频压得多重，管轰鸣和低音的起伏。'),
      bandAmount('mid_amount', '中频压缩量', '中频压得多重，管人声主体的起伏。'),
      bandAmount('high_amount', '高频压缩量', '高频压得多重，管齿音、镲片这类刺耳的瞬间。'),
      number('output', '输出增益', 'decibels', [-12, 12, 0.5], 0, undefined, '压完后整体音量再放大或减小。0（默认）不变。'),
    ], 'multi', 'multi_')
    ] },
  { id: 'limiter', name: '限幅器', group: 'audio_dynamics', media: 'audio', tooltip: '保证声音不超过设定的最大电平，防止爆音削波', description: '硬限幅：声音峰值永远不超过“最大电平”，提前约 5 毫秒预判并平滑压下，防止导出后爆音削波；可先提升输入增益让整体更响。片段音量在效果之前生效，淡化与过渡只会让声音更轻。',
    params: [
      number('ceiling', '最大电平', 'decibels', [-12, 0, 0.1], -1, '输出峰值的上限', '输出峰值上限 dBFS：-1（默认）常用于成片；-3 留更多余量；0 贴满。'),
      number('boost', '输入增益', 'decibels', [0, 12, 0.5], 0, '先把声音整体提升多少再限幅', '限幅前先提升的音量 dB：0（默认）只防削波；+6 整体明显更响（峰值仍不超过最大电平）。'),
    ] },
  { id: 'speech_leveler', name: '语音音量级别', group: 'audio_dynamics', media: 'audio', tooltip: '自动把忽大忽小的说话声拉到一致的音量', description: '自动电平：按说话声的平均电平（慢速 RMS）缓慢调整增益，把轻声抬高、大声压低到目标电平，适合离麦忽远忽近、多人音量不一的对白。低于噪声电平的部分视为停顿，保持当前增益、不把底噪抬上来；增益变化平缓，没有压缩器的“泵感”。',
    params: [
      number('target', '目标电平', 'decibels', [-36, -6, 0.5], -18, '说话声的平均音量要拉到多少', '目标平均电平 dBFS（RMS）：-18（默认）适合大多数对白与旁白；-14 更响，接近短视频平台常见的响度；-24 留更多余量。'),
      number('max_boost', '最大提升', 'decibels', [0, 30, 0.5], 12, '轻声最多被抬高多少', '最多提升的 dB：12（默认）；离麦很远、声音很轻时可加到 18–24；0 只压大声、不抬轻声。'),
      number('max_cut', '最大衰减', 'decibels', [0, 30, 0.5], 12, '大声最多被压低多少', '最多衰减的 dB：12（默认）；0 只抬轻声、不压大声。'),
      choice('speed', '响应速度', 'normal', [['slow', '慢'], ['normal', '中'], ['fast', '快']], '音量变化后多快跟上', 'slow 很平缓，适合讲座、播客等长段落；normal（默认）适合一般对白；fast 跟得更紧，适合多人快速对话，但起伏更明显。'),
      number('noise_floor', '噪声电平', 'decibels', [-90, -30, 1], -55, '低于这个电平视为停顿，不抬高', '低于此电平（dBFS，短时 RMS）的部分视为停顿：不更新电平估计、保持当前增益，底噪不会被抬上来；-55（默认）适合安静环境；底噪大时提高到 -45。'),
    ] },
  { id: 'noise_gate', name: '噪声门', group: 'audio_dynamics', media: 'audio', tooltip: '声音低于阈值时自动压低，去掉停顿里的底噪与串音', description: '低于阈值的声音（停顿里的底噪、远处的串音、呼吸）被压低，说话或演奏时门打开、原样通过。预判 1.5 毫秒，字头不被吃掉；关门阈值比开门低 4 dB，阈值附近不会反复开关。',
    params: [
      number('threshold', '阈值', 'decibels', [-90, 0, 1], -50, '高于这个电平门打开', '开门阈值 dBFS（峰值）：设在底噪之上、说话声之下；-50（默认）适合安静环境的人声；底噪大时提高到 -40 或 -35。'),
      number('reduction', '衰减量', 'decibels', [0, 90, 1], 30, '门关上时把声音压低多少', '门关闭时的衰减 dB：15 ≈ 底噪明显变小但仍自然；30（默认）≈ 底噪几乎听不到；60 以上完全静音（可能显得突兀）。'),
      number('attack', '启动时间', 'milliseconds', [0.1, 50, 0.1], 2, '门打开要多快', '门从全关到全开的时间 ms：2（默认）几乎立即打开、不吃字头；10 以上更柔和，但可能削弱爆破音。'),
      number('hold', '保持时间', 'milliseconds', [0, 500, 1], 50, '声音低于阈值后，门再保持打开多久', '声音落到阈值以下后门继续打开的时间 ms：50（默认）不在字与字之间频繁开关；200 以上适合语速慢、尾音长的录音。'),
      number('release', '释放时间', 'milliseconds', [5, 2000, 1], 150, '门关上要多慢', '门从全开到全关的时间 ms：150（默认）自然收尾；50 收得干脆；500 以上保留更多尾音。'),
    ] },
  { id: 'de_esser', name: '去齿音', group: 'audio_dynamics', media: 'audio', tooltip: '压低“嘶”“次”等刺耳的齿音', description: '只在齿音出现时压低高频（s、sh、c、z 等刺耳的嘶声），其余时间不影响音色。用于近距离录制的人声。',
    params: [
      strength('amount', '强度', 50, '齿音被压低的程度', '0 不处理；30 ≈ 轻微；50（默认）≈ 明显减轻齿音；100 ≈ 很强，可能让人声发闷（最多压低约 18 dB）。'),
      number('frequency', '起始频率', 'hertz', [3000, 10000, 100], 6000, '从多高的频率开始算作齿音', '齿音所在频段的下限 Hz：女声、童声常在 6000–8000，男声在 4000–6000；6000（默认）。'),
    ] },
  { id: 'delay_echo', name: '延迟与回声', group: 'audio_delay', media: 'audio', description: '把声音推迟，或在原声后面加上一次次变弱的重复。延迟用来对齐相机和录音笔录的声音，或让左右声道错开一点、听起来更宽；回声用来做强调、喊话、山谷和梦境感。',
    params: [
      choice('mode', '方式', 'delay', [['delay', '延迟'], ['echo', '回声']], undefined, '推迟一次，还是一次次重复。延迟（默认）整体推迟、不重复，用于对齐和加宽；回声在原声后面加上逐渐变弱、变暗的重复，原声不变。'),
      ...modeParams([
      number('left_delay', '左声道延迟', 'milliseconds', [0, 1000, 0.1], 0, undefined, '左声道推迟多久。0（默认）不推迟；对齐相机和录音笔时常差几十毫秒。序列是单声道时作用在唯一的声道上。'),
      number('right_delay', '右声道延迟', 'milliseconds', [0, 1000, 0.1], 0, undefined, '右声道推迟多久。0（默认）不推迟；和左声道差 10–20 ms 时声音明显变宽，偏向先响的一边。序列是单声道时不起作用。'),
      strength('mix', '延迟声比例', 100, undefined, '听到的是推迟后的声音还是原声。100（默认）只有推迟后的声音，用于对齐；50 两者各一半，叠出加倍的厚度；0 只有原声。'),
    ], 'delay', 'delay_'),
      ...modeParams([
      number('delay', '延迟时间', 'milliseconds', [1, 2000, 1], 250, undefined, '相邻两次回声隔多久。80–150 ms 像小房间里的拍打声；250 ms（默认）明显的回声；500 ms 以上像山谷。'),
      feedback(35, undefined, '回声重复多久才消失。0 只响一次；35（默认）五六次后听不到；70 拖得很长；95 几乎不衰减，慎用。'),
      strength('mix', '回声量', 30, undefined, '回声有多响。0 没有回声；30（默认）明显的回声；100 第一次回声和原声一样响。'),
      number('tone', '音色', 'hertz', [1000, 20000, 10], 8000, undefined, '回声一次比一次暗多少。8000 Hz（默认）略暗，像真实空间；3000 Hz 以下像老式磁带回声；20000 Hz 几乎不变暗。'),
      toggle('ping_pong', '左右交替', undefined, '回声在左右声道之间来回跳。默认关闭，每个声道各自回声；序列是单声道时不起作用。'),
    ], 'echo', 'echo_')
    ] },
  { id: 'equalizer', name: '均衡器', group: 'audio_eq', media: 'audio', description: '调整低、中、高频的强弱，改变声音的厚薄、明暗和清晰度。简易用三段加一键预设快速处理人声；参数自选频率和宽窄，精确修掉浑浊和共振，还带高通、低通；图形 10 段按固定频段推拉，最直观。全部为 0 时声音不变。',
    params: [
      choice('mode', '方式', 'simple', [['simple', '简易'], ['parametric', '参数'], ['graphic', '图形 10 段'], ['combined', '简易与参数']], undefined, '用哪种方式调。简易（默认）三段加预设，最快；参数自选频率和宽窄，最精细；图形 10 段按固定频段推拉；简易与参数两套同时生效、叠在一起。'),
      ...modeParams([
      { key: 'preset', name: '预设', type: 'enum', default: 'none', options: [{ value: 'none', label: '无' }, { value: 'voice_clarity', label: '人声更清楚' }, { value: 'remove_hum', label: '去低频嗡声' }, { value: 'warm', label: '更温暖' }, { value: 'bright', label: '更明亮' }], description: '一键套用常用的音色，下面三段可以在它上面再调。人声更清楚 去掉低频和浑浊、咬字更清楚，适合对白；去低频嗡声 去掉 50/60 Hz 电源嗡声和隆隆声；更温暖 更厚更柔；更明亮 更通透。默认无。' },
      band('low', '低频', undefined, '约 100 Hz 以下的低频，管声音有多厚重。0（默认）不变；+6 dB 明显更厚；-12 dB 明显变薄、更干净。'),
      band('mid', '中频', undefined, '约 1 kHz 的人声主体。0（默认）不变；往上加人声更突出、靠前；往下减更空、靠后。'),
      band('high', '高频', undefined, '约 8 kHz 以上的高频，管明亮和嘶声。0（默认）不变；+3 dB 更明亮通透；-6 dB 更闷，能压掉嘶声。'),
    ], 'simple', 'simple_'),
      ...modeParams([
      toggle('hp_on', '高通', undefined, '去掉高通频率以下的低频，如风噪、喷麦、桌面震动。默认关闭。'),
      number('hp_frequency', '高通频率', 'hertz', [20, 1000, 1], 80, undefined, '高通去掉多低的声音。80 Hz（默认）适合大多数人声；120–150 Hz 更干净但变薄。高通打开时才起作用。'),
      number('low_gain', '低频增益', 'decibels', [-15, 15, 0.5], 0, undefined, '低频频率以下的声音整体变强还是变弱。0（默认）不变；往上加更厚重，往下减更干净。'),
      number('low_frequency', '低频频率', 'hertz', [20, 1000, 1], 120, undefined, '低频增益管到多高。120 Hz（默认）；调高影响的范围更大。'),
      ...peakBand(1, 250, '浑浊感'), ...peakBand(2, 1000, '人声主体'), ...peakBand(3, 4000, '存在感'),
      number('high_gain', '高频增益', 'decibels', [-15, 15, 0.5], 0, undefined, '高频频率以上的声音整体变强还是变弱。0（默认）不变；往上加更明亮，往下减更闷，能压掉嘶声。'),
      number('high_frequency', '高频频率', 'hertz', [1000, 20000, 10], 8000, undefined, '高频增益从多高开始管。8000 Hz（默认）；调低影响的范围更大。'),
      toggle('lp_on', '低通', undefined, '去掉低通频率以上的高频，如嘶声。默认关闭。'),
      number('lp_frequency', '低通频率', 'hertz', [1000, 20000, 10], 16000, undefined, '低通去掉多高的声音。16000 Hz（默认）只压掉最高的嘶声；8000 Hz 明显去嘶声；3000 Hz 像电话。低通打开时才起作用。'),
    ], 'parametric', ''),
      ...modeParams([
      band('band_31', '31 Hz', undefined, '31 Hz 附近的超低频，震动和隆隆声在这里。0（默认）不变；往下减去掉隆隆声，往上加下潜更深；人声通常用不到。'),
      band('band_63', '63 Hz', undefined, '63 Hz 附近，管低音的力度。0（默认）不变；往上加低音更有劲，往下减轻轰鸣。'),
      band('band_125', '125 Hz', undefined, '125 Hz 附近，管声音的厚度，男声的胸腔共鸣在这里。0（默认）不变；往上加更厚实，往下减更干净。'),
      band('band_250', '250 Hz', undefined, '250 Hz 附近，管浑浊感。0（默认）不变；声音发闷、发浑时减 2–4 dB。'),
      band('band_500', '500 Hz', undefined, '500 Hz 附近，管闷罐、箱子感。0（默认）不变；往下减轻闷罐感，往上加更饱满。'),
      band('band_1k', '1 kHz', undefined, '1 kHz 附近，人声的主体。0（默认）不变；往上加人声更靠前，加多了有鼻音、电话感。'),
      band('band_2k', '2 kHz', undefined, '2 kHz 附近，管咬字清晰度。0（默认）不变；往上加咬字更清楚，加多了发硬。'),
      band('band_4k', '4 kHz', undefined, '4 kHz 附近，管存在感。0（默认）不变；加 2–4 dB 人声更透、更有存在感，加多了刺耳。'),
      band('band_8k', '8 kHz', undefined, '8 kHz 附近，管明亮度和齿音。0（默认）不变；往上加更明亮，往下减轻齿音和嘶声。'),
      band('band_16k', '16 kHz', undefined, '16 kHz 附近，管空气感。0（默认）不变；往上加更通透，往下减压掉最高的嘶声。'),
      band('output', '输出增益', undefined, '均衡之后整体音量再放大或减小。0（默认）不变；几段一起往上推、声音变响时用负值拉回。'),
    ], 'graphic', 'graphic_')
    ] },
  { id: 'audio_filter', name: '滤波', group: 'audio_eq', media: 'audio', description: '去掉一部分频率的声音。高通去掉低频，如风噪、喷麦、空调隆隆声；低通去掉高频，压掉嘶声，或做出隔墙、电话、水下的闷声；陷波只挖掉一个很窄的频率，去掉啸叫和单频干扰。去电源嗡声用“去除嗡嗡声”。',
    params: [
      choice('mode', '方式', 'high_pass', [['high_pass', '高通'], ['low_pass', '低通'], ['notch', '陷波']], undefined, '去掉哪一部分。高通（默认）去低频；低通去高频；陷波只去掉一个频率附近的窄带，其他声音几乎不受影响。'),
      ...modeParams([number('frequency', '截止频率', 'hertz', [20, 1000, 1], 80, undefined, '低于多少的声音被去掉。40 Hz 只去极低的隆隆声；80 Hz（默认）适合大多数人声；150 Hz 以上明显变薄，像电话。'), slope], 'high_pass', 'high_pass_'),
      ...modeParams([number('frequency', '截止频率', 'hertz', [500, 20000, 10], 8000, undefined, '高于多少的声音被去掉。12000 Hz 只压掉最刺的高频；8000 Hz（默认）明显去嘶声；3000 Hz 像隔墙或电话；1000 Hz 像在水下。'), slope], 'low_pass', 'low_pass_'),
      ...modeParams([
      number('frequency', '频率', 'hertz', [20, 20000, 1], 1000, undefined, '挖掉哪个音高的声音。设成啸叫、测试音这类干扰所在的频率；默认 1000 Hz。'),
      strength('width', '宽度', 50, undefined, '挖掉的范围有多宽。0 极窄，1 kHz 处只去约 33 Hz；50（默认）约 180 Hz；100 很宽，周围的声音也会变弱。'),
      number('depth', '深度', 'decibels', [-60, 0, 1], -30, undefined, '挖得多深。-30 dB（默认）明显压掉；-60 dB 几乎完全去除；0 不处理。'),
    ], 'notch', 'notch_')
    ] },
  { id: 'modulation', name: '调制', group: 'audio_modulation', media: 'audio', description: '让声音随时间起伏流动。和声叠上几个略有偏差的副本，声音更厚更宽，像多人齐唱；镶边是扫来扫去的“嗖——”喷气机声，带金属感；移相器是更柔和的旋转、流动感。常用于乐器、氛围、转场和科幻感。',
    params: [
      choice('mode', '方式', 'chorus', [['chorus', '和声'], ['flanger', '镶边'], ['phaser', '移相器']], undefined, '哪种起伏。和声（默认）更厚更宽，像多人齐唱；镶边是“嗖——”的喷气机声；移相器是柔和的旋转感，比镶边轻。'),
      ...modeParams([
      modulationRate(0.8, undefined, '副本音高摆动的快慢。0.3–1 Hz 自然的合唱感（默认 0.8 Hz）；2 Hz 以上明显颤动。'),
      strength('depth', '深度', 40, undefined, '音高摆动的幅度。0 不摆动，只是加倍；40（默认）自然；100 明显走音。'),
      number('voices', '声部数', 'value', [1, 4, 1], 2, undefined, '叠几个副本。1 像同一句录了两遍；2（默认）；4 最厚。'),
      mix(40, undefined, '和声占多少，其余是原声。0 只有原声；40（默认）明显更厚；100 只有和声，变成颤音。'),
    ], 'chorus', 'chorus_'),
      ...modeParams([
      modulationRate(0.3, undefined, '扫动的快慢。0.1–0.5 Hz 缓慢的经典镶边（默认 0.3 Hz）；2 Hz 以上快速颤动。'),
      strength('depth', '深度', 60, undefined, '扫过的范围。0 不扫动；60（默认）明显的扫动；100 扫得最远。'),
      feedback(40, undefined, '共振有多尖。0 柔和；40（默认）明显的金属声；80 以上很尖锐。调大不会变响。'),
      mix(50, undefined, '镶边声占多少，其余是原声。50（默认）效果最明显；20 轻微；100 只剩轻微的颤音。'),
    ], 'flanger', 'flanger_'),
      ...modeParams([
      modulationRate(0.5, undefined, '扫动的快慢。0.2–0.8 Hz 缓慢流动（默认 0.5 Hz）；3 Hz 以上像旋转音箱的快速颤动。'),
      strength('depth', '深度', 60, undefined, '扫过的音高范围。0 不扫动；60（默认）扫过中低频；100 一直扫到高频。'),
      choice('stages', '级数', '8', [['4', '4 级'], ['8', '8 级'], ['12', '12 级']], undefined, '同时有几道起伏，越多越浓。4 级柔和；8 级（默认）经典移相；12 级更浓重。'),
      feedback(30, undefined, '共振有多尖。0 柔和；30（默认）略有共振；80 以上尖锐的“哇”声。调大不会变响。'),
      mix(50, undefined, '移相声占多少，其余是原声。50（默认）效果最明显；100 只剩相位变化，几乎听不出。'),
    ], 'phaser', 'phaser_')
    ] },
  { id: 'noise_reduction', name: '降噪', group: 'audio_repair', media: 'audio', tooltip: '去掉人声里的背景噪声，如风扇、空调、电流底噪', description: '基于 RNNoise 神经网络的人声降噪：保留说话声，去掉稳定或变化的背景噪声（风扇、空调、键盘、街道）。只适合人声，不适合音乐。',
    params: [strength('strength', '降噪强度', 80, '噪声被去掉的程度', '0 不降噪；50 ≈ 噪声减半（约 -6 dB）；80（默认）≈ 噪声明显降低（约 -14 dB）、人声自然；100 完全交给降噪模型，最干净但人声可能略显单薄。')] },
  { id: 'dehum', name: '去除嗡嗡声', group: 'audio_repair', media: 'audio', tooltip: '去掉电源干扰带来的 50/60 Hz 嗡声及其倍频', description: '去掉电源嗡声：在基频（国内 50 Hz）及其倍频上各挖一个窄凹口，并用四阶高通切掉 30 Hz 以下的直流与次低频。人声与音乐的其他部分几乎不受影响。',
    params: [
      choice('mains', '电源频率', '50', [['50', '50 Hz（国内）'], ['60', '60 Hz']], '嗡声的基频：国内、欧洲为 50 Hz，北美等地为 60 Hz', '50（默认）中国大陆、欧洲等地的电网；60 北美、日本西部等地。'),
      number('harmonics', '谐波数', 'value', [1, 10, 1], 5, '去掉基频及多少个倍频', '处理的频率个数（含基频）：1 只去基频；5（默认）去 50–250 Hz；10 去到 500 Hz（嗡声发“毛”、带蜂鸣时用）。'),
      strength('amount', '强度', 80, '凹口的深度与宽度，越大去得越干净', '深度 = -0.6 × 强度 dB，Q = 30 - 0.2 × 强度（-3 dB 处带宽 ≈ 频率 / Q）：0 不去嗡声（只保留 30 Hz 高通）；80（默认）每个凹口约 -48 dB、Q 14（50 Hz 处约 3.6 Hz 宽）；100 约 -60 dB、Q 10（更深更宽，容得下电源频率的小漂移）。'),
    ] },
  { id: 'reverb', name: '混响', group: 'audio_space', media: 'audio', tooltip: '加入房间或大厅的空间感', description: '模拟房间反射（Freeverb 算法）：让干涩的录音有空间感，或营造大厅、回忆、梦境氛围。',
    params: [
      strength('room_size', '空间大小', 50, '房间有多大，越大余音越长', '0 很小的房间（余音很短）；50（默认）中等房间；80 大厅；100 非常长的余音。'),
      strength('damping', '高频衰减', 50, '余音里高频消失得多快，越大越闷', '0 余音明亮（瓷砖浴室）；50（默认）自然；100 很闷（铺满软装的房间）。'),
      strength('mix', '混响量', 25, '混响声相对原声的多少', '0 只有原声；15 ≈ 轻微空间感；25（默认）≈ 明显房间感；60 以上原声被淹没，像在远处。'),
    ] },
  { id: 'distortion', name: '扭曲', group: 'audio_special', media: 'audio', tooltip: '让声音失真、发毛，像过载的音箱、对讲机或老收音机', description: '波形整形失真：先按驱动放大再削平波形，加上谐波让声音发毛、变脏；失真后低通控制刺耳程度。输出按驱动自动补偿，加大驱动只增加失真、不会越来越响。用于对讲机、喊话、电吉他、故障感。',
    params: [
      number('drive', '驱动', 'decibels', [0, 40, 0.5], 12, '失真程度，越大越脏', '失真前的增益 dB：6 轻微温暖的饱和；12（默认）明显失真；24 以上很重的过载；40 接近方波。'),
      number('tone', '音色', 'hertz', [500, 20000, 10], 8000, '失真后保留多少高频，越低越闷', '失真后低通的截止频率 Hz：8000（默认）去掉最刺耳的毛刺；3000 像对讲机、电话；20000 保留全部高频（最刺）。'),
      mix(100, '失真声相对原声的比例', '100（默认）只有失真声；30–50 原声与失真声混合（并联失真，保留清晰度）。'),
      choice('character', '类型', 'soft', [['soft', '柔和'], ['hard', '硬削波'], ['tube', '电子管']], '失真的质感', 'soft（默认）圆润的软削波，像过载的磁带；hard 硬削波，刺耳，像数字过载与对讲机；tube 不对称的电子管饱和，带偶次谐波，更温暖。'),
    ] },
  { id: 'vocal_enhancer', name: '人声增强', group: 'audio_special', media: 'audio', tooltip: '一键让人声更清楚、更有存在感', description: '按嗓音类型套用固定的均衡曲线并乘以强度：去浑浊（中低频衰减）+ 提升存在感（中高频提升）+ 柔和高频（高频搁架略降）。强度 100 时：low 为 220 Hz -5 dB、3.2 kHz +4 dB、9 kHz 以上 -2 dB；high 为 350 Hz -3 dB、2.5 kHz +3 dB、7 kHz 以上 -4 dB（同时减轻刺耳与齿音）；music 为 300 Hz -3 dB、2 kHz +4 dB、10 kHz 以上 -1.5 dB（让人声从配乐里突出）。强度 0 时声音不变。',
    params: [
      choice('voice', '嗓音类型', 'low', [['low', '低沉嗓音'], ['high', '高亮嗓音'], ['music', '人声配乐']], '按录音选择对应的曲线', 'low（默认）偏低沉的嗓音（多为男声），去掉轰鸣与浑浊；high 偏高亮的嗓音（多为女声、童声），减轻刺耳与齿音；music 人声与配乐混在一起时，让人声更突出。'),
      strength('amount', '强度', 60, '增强程度，0 不处理', '曲线增益的比例：0 不变；60（默认）≈ 明显更清楚而不夸张；100 为曲线的完整增益。'),
    ] },
  { id: 'pitch_shift', name: '音调变换', group: 'audio_pitch', media: 'audio', tooltip: '升高或降低音调，速度不变', description: '在不改变速度与时长的情况下升降音调（相位声码器）：+12 高一个八度（卡通、小黄人感），-5 声音低沉，-12 低一个八度（怪物感）；±1 以内可微调人声。',
    params: [number('semitones', '变调', 'semitones', [-12, 12, 0.5], 0, '正值升高音调，负值降低，单位为半音', '音调偏移的半音数：0（默认）不变；+12 高一个八度；-12 低一个八度；+3/-3 ≈ 明显但仍自然。')] },
]
