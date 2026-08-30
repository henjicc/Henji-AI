import type { ImageEditMaskReferenceV3 } from './layerTypes';
import type {
  ImageEditRenderNodeCategory,
  ImageEditRenderQuality,
} from './renderNodeDefinition';

export interface ImageEditRenderPlanNode {
  id: string;
  layerId: string;
  layerPath: readonly string[];
  definitionId: string;
  definitionVersion: number;
  category: ImageEditRenderNodeCategory;
  inputNodeIds: readonly string[];
  parameters: Readonly<Record<string, unknown>>;
  mask: ImageEditMaskReferenceV3 | null;
  subtreeHash: string;
}

export interface ImageEditRenderPass {
  id: string;
  kind: 'single' | 'fused-pointwise';
  nodeIds: readonly string[];
}

export interface ImageEditRenderPlanDiagnostic {
  layerId: string;
  code: 'unsupported-layer' | 'missing-definition' | 'empty-effect-scope';
  message: string;
}

export interface ImageEditRenderPlan {
  documentId: string;
  revision: number;
  quality: ImageEditRenderQuality;
  nodes: readonly ImageEditRenderPlanNode[];
  passes: readonly ImageEditRenderPass[];
  outputNodeId: string | null;
  outputHash: string;
  layerEvaluationOrder: readonly string[];
  diagnostics: readonly ImageEditRenderPlanDiagnostic[];
}
