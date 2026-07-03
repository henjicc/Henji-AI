import { CAMERA_STAGE_TIMELINE_HEX } from '@/core/theme/colorTokens'

/** 曲线图分量配色：位置/旋转/缩放/关节的 X/Y/Z 分量按轴取色，其余（如 FOV）走强调色 */
export function axisColor(path: string): string {
  if (path.endsWith('.x')) return CAMERA_STAGE_TIMELINE_HEX.axisX
  if (path.endsWith('.y')) return CAMERA_STAGE_TIMELINE_HEX.axisY
  if (path.endsWith('.z')) return CAMERA_STAGE_TIMELINE_HEX.axisZ
  return CAMERA_STAGE_TIMELINE_HEX.curveOther
}
