import { ParamDef } from '../types/schema'

/**
 * Wan 2.5 Preview 模型参数定义
 */
export const wan25PreviewParams: ParamDef[] = [
    {
        id: 'videoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 5,  // Wan 2.5 默认 5 秒
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
