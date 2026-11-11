import type { CanvasNode, NodeToolType } from '../domain/canvasNodes';
import type { ToolProcessorResult } from '../application/ports';

type ToolOptionPrimitive = string | number | boolean;
export type ToolOptions = Record<string, ToolOptionPrimitive>;

interface ToolFieldBase {
  key: string;
  label: string;
}

interface ToolTextField extends ToolFieldBase {
  type: 'text';
  placeholder?: string;
}

interface ToolNumberField extends ToolFieldBase {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
}

interface ToolSelectField extends ToolFieldBase {
  type: 'select';
  options: Array<{
    label: string;
    value: string;
  }>;
}

interface ToolColorField extends ToolFieldBase {
  type: 'color';
}

export type ToolFieldSchema =
  | ToolTextField
  | ToolNumberField
  | ToolSelectField
  | ToolColorField;

interface ToolExecutionContext {
  processTool: (
    toolType: NodeToolType,
    sourceImageUrl: string,
    options: DynamicValueMap
  ) => Promise<ToolProcessorResult>;
}

export type ToolIconKey = 'edit' | 'split';
type ToolEditorKind = 'form' | 'edit' | 'split';

interface CanvasToolDialogDefinition {
  size: 'editor' | 'workspace';
  resultNodeTitle: string;
  preloadStoryboardMetadata?: boolean;
}

export interface CanvasToolPlugin {
  type: NodeToolType;
  label: string;
  icon: ToolIconKey;
  /** 工具条上的样子：通用、图标认得的动作（编辑）只放图标，悬停给名称；不写时图标加文字（这个节点特有的事） */
  display?: 'icon';
  editor: ToolEditorKind;
  dialog: CanvasToolDialogDefinition;
  operationIds?: string[];
  supportsNode: (node: CanvasNode) => boolean;
  createInitialOptions: (node: CanvasNode) => ToolOptions;
  fields: ToolFieldSchema[];
  execute: (
    sourceImageUrl: string,
    options: ToolOptions,
    context: ToolExecutionContext
  ) => Promise<ToolProcessorResult>;
}
