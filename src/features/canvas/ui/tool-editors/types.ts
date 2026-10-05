import type { CanvasToolPlugin, ToolFieldSchema, ToolOptions } from '@/features/canvas/tools';

export interface ToolEditorBaseProps {
  plugin: CanvasToolPlugin;
  options: ToolOptions;
  onOptionsChange: (next: ToolOptions) => void;
}

export interface VisualToolEditorProps extends ToolEditorBaseProps {
  sourceImageUrl: string;
  /** 外层“应用”是否可点：重型编辑宿主在权威版本保存后、切割编辑器在版式可切时报告就绪。 */
  onExecutionReadyChange?: (ready: boolean) => void;
}

export interface FormToolEditorProps extends ToolEditorBaseProps {
  fields: ToolFieldSchema[];
}
