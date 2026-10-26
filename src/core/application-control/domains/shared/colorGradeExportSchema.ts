import { z } from 'zod'
import { COLOR_GRADE_LUT_SIZES, DEFAULT_COLOR_GRADE_LUT_SIZE } from '../../../imaging/lut/colorGradeExport'

/** 剪辑与图片的调色导出共用同一组输入字段与回执，算法与写文件走同一个服务（src/services/colorGradeExport.ts）。 */
export const colorGradeExportInputShape = {
  format: z.enum(['cube', 'cdl']).describe('cube：3D LUT，逐格点精确求值，几乎所有剪辑/调色软件可读；cdl：ASC CDL，只有每通道斜率/偏移/幂与整体饱和度，是拟合近似，调色含混色器、色相曲线、HSL 辅助、LUT 或明显对比度时多半拒绝并建议改用 cube。'),
  lutSize: z.union([z.literal(COLOR_GRADE_LUT_SIZES[0]), z.literal(COLOR_GRADE_LUT_SIZES[1]), z.literal(COLOR_GRADE_LUT_SIZES[2])]).optional()
    .describe(`只用于 cube。默认 ${DEFAULT_COLOR_GRADE_LUT_SIZE}（通用、约 1 MB）；65 精度更高（约 7 MB），部分软件与相机不接受；17 只给有尺寸限制的设备。`),
  path: z.string().trim().min(1).max(4096).describe('要写出的本机绝对路径，扩展名与 format 一致（.cube 或 .cdl）。'),
  overwrite: z.boolean().optional().describe('目标文件已存在时覆盖；先问用户。'),
}
export const colorGradeExportAccuracySchema = z.object({
  meanDeltaE: z.number().nonnegative(), maxDeltaE: z.number().nonnegative(), samples: z.number().int().positive(),
}).strict().describe('写出后用正式解析器读回，512 个测试色与正式调色比较的 CIEDE2000 色差；<1 基本看不出，2–3 一眼可见。')
export const colorGradeExportOutputShape = {
  path: z.string(), format: z.enum(['cube', 'cdl']), lutSize: z.number().int().optional(), bytes: z.number().int().nonnegative(),
  omitted: z.array(z.string()).describe('没有写进文件的部分（锐化、晕影等空间操作，效果强度、不透明度、蒙版等合成属性）。'),
  approximated: z.array(z.string()), inexpressible: z.array(z.string()).describe('只用于 cdl：CDL 无法表达、已整体近似的调色部分。'),
  cdl: z.object({ slope: z.array(z.number()).length(3), offset: z.array(z.number()).length(3), power: z.array(z.number()).length(3), saturation: z.number() }).strict().optional(),
  accuracy: colorGradeExportAccuracySchema,
  message: z.string(),
  verification: z.object({ verified: z.boolean(), condition: z.string() }).strict(),
}
export const COLOR_GRADE_EXPORT_DESCRIPTION = '输入与输出都是 sRGB 原色（同 Rec.709）的 sRGB 编码值，0–1，与痕迹AI 渲染管线的调色工作域一致；在其他软件里用作 Rec.709/sRGB 显示参考的 LUT。锐化、晕影等依赖相邻像素或位置的操作无法进 LUT，回执 omitted 如实列出。目标文件已存在时拒绝，确认后传 overwrite=true。只写文件，不修改作品。'
