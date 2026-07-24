import type { CanvasNode, NodeToolType } from '../domain/canvasNodes';
import type { ToolProcessorResult } from '../application/ports';

export type ToolOptionPrimitive = string | number | boolean;
export type ToolOptions = Record<string, ToolOptionPrimitive>;

interface ToolFieldBase {
  key: string;
  label: string;
}

export interface ToolTextField extends ToolFieldBase {
  type: 'text';
  placeholder?: string;
}

export interface ToolNumberField extends ToolFieldBase {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
}

export interface ToolSelectField extends ToolFieldBase {
  type: 'select';
  options: Array<{
    label: string;
    value: string;
  }>;
}

export interface ToolColorField extends ToolFieldBase {
  type: 'color';
}

export type ToolFieldSchema =
  | ToolTextField
  | ToolNumberField
  | ToolSelectField
  | ToolColorField;

export interface ToolExecutionContext {
  processTool: (
    toolType: NodeToolType,
    sourceImageUrl: string,
    options: DynamicValueMap
  ) => Promise<ToolProcessorResult>;
}

export type ToolIconKey = 'edit' | 'split';
export type ToolEditorKind = 'form' | 'edit' | 'split';

export interface CanvasToolDialogDefinition {
  widthClassName: string;
  resultNodeTitle: string;
  preloadStoryboardMetadata?: boolean;
}

export interface CanvasToolPlugin {
  type: NodeToolType;
  label: string;
  icon: ToolIconKey;
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
