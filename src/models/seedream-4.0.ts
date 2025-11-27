import { ParamDef } from '../types/schema'

/**
 * 即梦 4.0 模型参数定义
 */
export const seedream40Params: ParamDef[] = [
    {
        id: 'maxImages',
        type: 'number',
        label: '数量',
        min: 1,
        max: 15,
        step: 1,
        widthClassName: 'w-20',
        tooltip: '设置为1时仅生成单张图片；大于1时，会根据该数值生成多张图片。参考图+生成图片的总数不能超过15张。',
        tooltipDelay: 500
    }
]
