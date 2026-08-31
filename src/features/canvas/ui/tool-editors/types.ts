import type { CanvasToolPlugin, ToolFieldSchema, ToolOptions } from '@/features/canvas/tools';

export interface ToolEditorBaseProps {
  plugin: CanvasToolPlugin;
  options: ToolOptions;
  onOptionsChange: (next: ToolOptions) => void;
}

export interface VisualToolEditorProps extends ToolEditorBaseProps {
  sourceImageUrl: string;
  /** 重型编辑宿主仅在权威版本已保存后允许外层执行。 */
  onExecutionReadyChange?: (ready: boolean) => void;
}

export interface FormToolEditorProps extends ToolEditorBaseProps {
  fields: ToolFieldSchema[];
}
