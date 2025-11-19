import { ParamDef } from '../types/schema'

export const wan25Params: ParamDef[] = [
    {
        id: 'videoDuration',
        type: 'dropdown',
        label: '时长',
        options: [
            { value: 5, label: '5s' },
            { value: 10, label: '10s' }
        ]
    },
    {
        id: 'wanSize',
        type: 'dropdown',
        label: '尺寸',
        options: [
            '832*480', '480*832', '624*624',
            '1280*720', '720*1280', '960*960', '1088*832', '832*1088',
            '1920*1080', '1080*1920', '1440*1440', '1632*1248', '1248*1632'
        ].map(v => ({ value: v, label: v })),
        className: 'min-w-[140px]',
        panelClassName: 'w-[260px]',
        hidden: (values) => values.uploadedImages.length > 0
    },
    {
        id: 'wanResolution',
        type: 'dropdown',
        label: '分辨率',
        options: ['480P', '720P', '1080P'].map(v => ({ value: v, label: v })),
        hidden: (values) => values.uploadedImages.length === 0
    },
    {
        id: 'wanPromptExtend',
        type: 'toggle',
        label: '智能改写'
    },
    {
        id: 'wanAudio',
        type: 'toggle',
        label: '音频'
    }
]

export const viduParams: ParamDef[] = [
    {
        id: 'viduMode',
        type: 'dropdown',
        label: '模式',
        options: [
            { value: 'text-image-to-video', label: '文/图生视频' },
            { value: 'start-end-frame', label: '首尾帧' },
            { value: 'reference-to-video', label: '参考生视频' }
        ],
        className: 'min-w-[120px]'
    },
    {
        id: 'viduAspectRatio',
        type: 'dropdown',
        label: '宽高比',
        options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ],
        hidden: (values) => {
            const { viduMode, uploadedImages } = values
            // Show if: (text-image mode AND no images) OR (reference mode)
            const isTextImageNoImg = viduMode === 'text-image-to-video' && uploadedImages.length === 0
            const isRefMode = viduMode === 'reference-to-video'
            return !(isTextImageNoImg || isRefMode)
        }
    },
    {
        id: 'viduStyle',
        type: 'dropdown',
        label: '风格',
        options: [
            { value: 'general', label: '通用' },
            { value: 'anime', label: '动漫' }
        ],
        hidden: (values) => {
            // Show only if: text-image mode AND no images
            return !(values.viduMode === 'text-image-to-video' && values.uploadedImages.length === 0)
        }
    },
    {
        id: 'viduMovementAmplitude',
        type: 'dropdown',
        label: '运动幅度',
        options: [
            { value: 'auto', label: '自动' },
            { value: 'small', label: '小' },
            { value: 'medium', label: '中' },
            { value: 'large', label: '大' }
        ]
    },
    {
        id: 'viduBgm',
        type: 'dropdown',
        label: 'BGM',
        options: [
            { value: false, label: '关闭' },
            { value: true, label: '开启' }
        ]
    }
]

export const klingParams: ParamDef[] = [
    {
        id: 'videoDuration',
        type: 'dropdown',
        label: '时长',
        options: [
            { value: 5, label: '5s' },
            { value: 10, label: '10s' }
        ]
    },
    {
        id: 'videoAspectRatio',
        type: 'dropdown',
        label: '宽高比',
        options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ],
        hidden: (values) => values.uploadedImages.length > 0
    },
    {
        id: 'klingCfgScale',
        type: 'number',
        label: 'CFG Scale',
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        widthClassName: 'w-24'
    }
]

export const hailuoParams: ParamDef[] = [
    {
        id: 'videoDuration',
        type: 'dropdown',
        label: '时长',
        options: [
            { value: 6, label: '6s' },
            { value: 10, label: '10s' }
        ]
    },
    {
        id: 'videoResolution',
        type: 'dropdown',
        label: '分辨率',
        options: (values) => [
            { value: '768P', label: '768P' },
            { value: '1080P', label: '1080P', disabled: values.videoDuration !== 6 }
        ]
    },
    {
        id: 'hailuoFastMode',
        type: 'toggle',
        label: 'Fast模式',
        hidden: (values) => {
            // Show only if model is 'minimax-hailuo-2.3' AND images are uploaded
            return !(values.selectedModel === 'minimax-hailuo-2.3' && values.uploadedImages.length > 0)
        }
    }
]

export const pixverseParams: ParamDef[] = [
    {
        id: 'videoAspectRatio',
        type: 'dropdown',
        label: '宽高比',
        options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ],
        hidden: (values) => values.uploadedImages.length > 0
    },
    {
        id: 'videoResolution',
        type: 'dropdown',
        label: '分辨率',
        options: (values) => [
            { value: '360p', label: '360p' },
            { value: '540p', label: '540p' },
            { value: '720p', label: '720p' },
            { value: '1080p', label: '1080p', disabled: values.pixFastMode }
        ]
    },
    {
        id: 'pixFastMode',
        type: 'toggle',
        label: '快速模式'
    }
]

export const seedanceParams: ParamDef[] = [
    {
        id: 'seedanceVariant',
        type: 'dropdown',
        label: '版本',
        options: [
            { value: 'lite', label: 'Lite' },
            { value: 'pro', label: 'Pro' }
        ],
        hidden: (values) => values.selectedModel !== 'seedance-v1'
    },
    {
        id: 'videoDuration',
        type: 'dropdown',
        label: '时长',
        options: [
            { value: 5, label: '5s' },
            { value: 10, label: '10s' }
        ]
    },
    {
        id: 'seedanceResolution',
        type: 'dropdown',
        label: '分辨率',
        options: ['480p', '720p', '1080p'].map(v => ({ value: v, label: v }))
    },
    {
        id: 'seedanceAspectRatio',
        type: 'dropdown',
        label: '宽高比',
        options: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'].map(v => ({ value: v, label: v })),
        hidden: (values) => values.uploadedImages && values.uploadedImages.length > 0
    },
    {
        id: 'seedanceCameraFixed',
        type: 'toggle',
        label: '相机固定'
    }
]

export const seedreamParams: ParamDef[] = [
    {
        id: 'sequentialImageGeneration',
        type: 'toggle',
        label: '批量生成',
        tooltip: '设置为自动时，可以通过提示词描述控制生成的图片数量，例如：生成4张图片。实际数量会受限于最大数量的设置，同时参考图+想要生成图片的数量无法超过15张。',
        tooltipDelay: 500,
        toValue: (checked) => checked ? 'auto' : 'disabled',
        fromValue: (value) => value === 'auto'
    },
    {
        id: 'maxImages',
        type: 'number',
        label: '最大数量',
        min: 1,
        max: 15,
        step: 1,
        widthClassName: 'w-20',
        hidden: (values) => values.sequentialImageGeneration !== 'auto'
    }
]

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

export const minimaxSpeechBasicParams: ParamDef[] = [
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

export const minimaxSpeechAdvancedParams: ParamDef[] = [
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

