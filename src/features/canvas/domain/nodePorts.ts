/**
 * 画布节点端口与媒体注入规范。
 *
 * - 每个节点通过 ports 声明输入/输出端口接受与产出的媒体类型
 * - 连接校验与连接菜单按"上游 emits ∩ 下游 accepts"判定，禁止节点类型特判
 * - 上游输出按 InputInjectionRule 注入下游生成参数（与对话模式协议键一致）
 */

import type { SocketType } from '@/core/types/SocketType';

export type MediaKind = 'image' | 'video' | 'audio' | 'text';

export interface NodePorts {
  /** 输出端口（右侧 source handle）产出的媒体类型 */
  source?: {
    emits: MediaKind;
  };
  /** 输入端口（左侧 target handle）可接受的媒体类型 */
  target?: {
    accepts: MediaKind[];
  };
}

export interface NodeGenerationSpec {
  /** 模型列表来源：registry.getModelsByType(modelType) */
  modelType: 'image' | 'video' | 'audio';
  /** 生成结果落地的展示节点类型（CanvasNodeType 字符串） */
  resultNodeType: string;
}

/** 节点产出的媒体输出（供下游节点消费） */
export interface NodeMediaOutput {
  kind: MediaKind;
  url: string;
  previewUrl?: string | null;
}

/**
 * 节点产出的标量值输出（数值/源节点 → 下游参数端口）。
 * 借鉴 ComfyUI 的 primitive 节点：一个源节点可 fan-out 给多个参数端口。
 */
export interface NodeValueOutput {
  socketType: SocketType;
  value: unknown;
}

/**
 * 上游媒体 → 生成参数协议键的注入规则。
 * 协议键与对话模式 useTaskGeneration 完全一致，由 Rust runtime 统一消费。
 */
export interface InputInjectionRule {
  accepts: MediaKind;
  paramKeys: {
    list: string;
    pathList: string;
  };
  maxCount?: number;
}

export const DEFAULT_INPUT_INJECTION_RULES: InputInjectionRule[] = [
  { accepts: 'image', paramKeys: { list: 'images', pathList: 'uploadedFilePaths' } },
  { accepts: 'video', paramKeys: { list: 'videos', pathList: 'uploadedVideoFilePaths' } },
  { accepts: 'audio', paramKeys: { list: 'audios', pathList: 'uploadedAudioFilePaths' } },
];

export function arePortsCompatible(
  sourcePorts: NodePorts | undefined,
  targetPorts: NodePorts | undefined
): boolean {
  const emits = sourcePorts?.source?.emits;
  const accepts = targetPorts?.target?.accepts;
  if (!emits || !accepts || accepts.length === 0) {
    return false;
  }
  return accepts.includes(emits);
}
