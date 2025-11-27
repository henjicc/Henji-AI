import { ParamDef } from '../types/schema'

// Minimax Speech emotion mapping
const emotionZhMap: Record<string, string> = {
    neutral: '中性',
    happy: '开心',
    sad: '悲伤',
    angry: '愤怒',
    fearful: '恐惧',
    disgusted: '厌恶',
    surprised: '惊讶'
}

// Minimax Speech language boost mapping
const languageBoostZhMap: Record<string, string> = {
    auto: '自动',
    Chinese: '中文',
    'Chinese,Yue': '中文：粤语',
    English: '英语',
    Arabic: '阿拉伯语',
    Russian: '俄语',
    Spanish: '西班牙语',
    French: '法语',
    Portuguese: '葡萄牙语',
    German: '德语',
    Turkish: '土耳其语',
    Dutch: '荷兰语',
    Ukrainian: '乌克兰语',
    Vietnamese: '越南语',
    Indonesian: '印尼语',
    Japanese: '日语',
    Italian: '意大利语',
    Korean: '韩语',
    Thai: '泰语',
    Polish: '波兰语',
    Romanian: '罗马尼亚语',
    Greek: '希腊语',
    Czech: '捷克语',
    Finnish: '芬兰语',
    Hindi: '印地语'
}

/**
 * Minimax Speech 2.6 基础参数定义
 */
export const minimaxSpeech26BasicParams: ParamDef[] = [
    {
        id: 'audioSpec',
        type: 'dropdown',
        label: '规格',
        options: [
            { value: 'hd', label: 'HD' },
            { value: 'turbo', label: 'Turbo' }
        ],
        className: 'min-w-[70px]'
    },
    {
        id: 'audioEmotion',
        type: 'dropdown',
        label: '情绪',
        options: ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised']
            .map(x => ({ value: x, label: emotionZhMap[x] || x })),
        className: 'min-w-[70px]'
    },
    {
        id: 'languageBoost',
        type: 'dropdown',
        label: '语言增强',
        options: ['auto', 'Chinese', 'Chinese,Yue', 'English', 'Arabic', 'Russian', 'Spanish',
            'French', 'Portuguese', 'German', 'Turkish', 'Dutch', 'Ukrainian', 'Vietnamese',
            'Indonesian', 'Japanese', 'Italian', 'Korean', 'Thai', 'Polish', 'Romanian',
            'Greek', 'Czech', 'Finnish', 'Hindi']
            .map(x => ({ value: x, label: languageBoostZhMap[x] || x })),
        className: 'min-w-[140px]'
    }
]

/**
 * Minimax Speech 2.6 高级参数定义
 */
export const minimaxSpeech26AdvancedParams: ParamDef[] = [
    {
        id: 'audioVol',
        type: 'number',
        label: '音量',
        min: 0.1,
        max: 10,
        step: 0.1,
        precision: 2,
        widthClassName: 'w-[100px]'
    },
    {
        id: 'audioPitch',
        type: 'number',
        label: '语调',
        min: -12,
        max: 12,
        step: 1,
        widthClassName: 'w-[100px]'
    },
    {
        id: 'audioSpeed',
        type: 'number',
        label: '速度',
        min: 0.5,
        max: 2,
        step: 0.1,
        precision: 1,
        widthClassName: 'w-[100px]'
    },
    {
        id: 'audioSampleRate',
        type: 'dropdown',
        label: '采样率',
        options: [8000, 16000, 22050, 24000, 32000, 44100]
            .map(r => ({ value: r, label: String(r) }))
    },
    {
        id: 'audioBitrate',
        type: 'dropdown',
        label: '比特率',
        options: [32000, 64000, 128000, 256000]
            .map(r => ({ value: r, label: String(r) }))
    },
    {
        id: 'audioFormat',
        type: 'dropdown',
        label: '格式',
        options: ['mp3', 'pcm', 'flac', 'wav']
            .map(f => ({ value: f, label: f }))
    },
    {
        id: 'audioChannel',
        type: 'dropdown',
        label: '声道',
        options: [1, 2]
            .map(c => ({ value: c, label: String(c) }))
    },
    {
        id: 'latexRead',
        type: 'toggle',
        label: '朗读 LaTeX'
    },
    {
        id: 'textNormalization',
        type: 'toggle',
        label: '英文规范化'
    }
]
