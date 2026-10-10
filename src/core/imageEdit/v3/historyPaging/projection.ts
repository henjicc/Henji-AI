import type { ImageEditCommandV3 } from '../commandTypes';

export interface ImageEditHistoryRowV3 {
  /** 0 表示本次可恢复历史的起点；其余值为该操作完成后的位置。 */
  position: number;
  key: string;
  kind: 'initial' | 'document' | 'selection';
  labelKey: string;
  label: string;
  targetName: string | null;
}

export interface ImageEditHistoryViewV3 {
  position: number;
  total: number;
  generation: number;
}

export interface ImageEditHistoryJumpOptionsV3 {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  /** 宿主负责线程调度；纯 core 不依赖 DOM、feature 或视频播放头。 */
  yieldControl?: () => Promise<void>;
}

const labels: Record<ImageEditCommandV3['type'], string> = {
  'layer.replace': '更新图层内容',
  'document.atomic': '转换滤镜范围',
  'document.set-named-regions': '管理通道', 'layer.move-many': '移动图层',
  'document.update-output-geometry': '调整画面',
  'layer.add': '添加图层', 'layer.delete': '删除图层', 'layer.move': '移动图层',
  'layer.duplicate': '复制图层', 'layer.group': '组合图层', 'layer.ungroup': '解散图层组',
  'layer.update-common': '调整图层', 'layer.update-params': '调整效果',
  'group.update-isolation': '调整图层组合成', 'layer.set-mask': '调整蒙版',
  'annotation.add': '添加标注', 'annotation.update': '修改标注', 'annotation.delete': '删除标注',
  'raster.apply-tile-delta': '绘制像素', 'mask.apply-tile-delta': '绘制蒙版',
};

export function projectImageEditHistoryCommandV3(command: ImageEditCommandV3): Pick<ImageEditHistoryRowV3, 'labelKey' | 'label' | 'targetName'> {
  const targetName = command.type === 'layer.add' ? command.layer.name
    : command.type === 'layer.group' ? command.group.name
    : command.type === 'layer.update-common' ? command.patch.name ?? null : null;
  return { labelKey: `imageEditor.v3.history.commands.${command.type}`, label: labels[command.type], targetName };
}
