/**
 * 画布节点端口与媒体注入规范。
 *
 * - 每个节点通过 ports 声明输入/输出端口接受与产出的媒体类型
 * - 连接校验与连接菜单按"上游 emits ∩ 下游 accepts"判定，禁止节点类型特判
 * - 上游输出按 InputInjectionRule 注入下游生成参数（与对话模式协议键一致）
 */

import type { SocketType } from '@/core/types/SocketType';

export type MediaKind = 'image' | 'video' | 'audio' | 'text';
export type MediaPortKind = Exclude<MediaKind, 'text'>;

const MEDIA_SOURCE_PORT_PREFIX = 'source:';

/** 多媒体源节点的类型化输出端口，如 source:image。 */
export function mediaSourcePortId(kind: MediaPortKind): string {
  return `${MEDIA_SOURCE_PORT_PREFIX}${kind}`;
}

/** 从类型化输出端口反查媒体类型，普通 source 端口返回 null。 */
export function parseMediaSourcePortId(
  handleId: string | null | undefined
): MediaPortKind | null {
  if (typeof handleId !== 'string' || !handleId.startsWith(MEDIA_SOURCE_PORT_PREFIX)) {
    return null;
  }
  const kind = handleId.slice(MEDIA_SOURCE_PORT_PREFIX.length);
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null;
}

export interface NodePorts {
  /** 输出端口（右侧 source handle）产出的媒体类型 */
  source?: {
    emits: MediaKind;
    /** 多输出节点按 source handle 声明各自的媒体类型；未声明时沿用 emits。 */
    handles?: Record<string, MediaKind>;
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
  /** 运行时解析补齐的来源节点 ID，用于构造稳定的结构化提示词引用。 */
  sourceNodeId?: string;
  /** 多输出节点的来源端口；省略表示默认 source 端口。 */
  sourceHandle?: string;
  /** 同一来源端口内的稳定输出序号。 */
  outputIndex?: number;
}

export function getSourcePortMediaKind(
  ports: NodePorts | undefined,
  sourceHandle: string | null | undefined,
): MediaKind | undefined {
  const source = ports?.source;
  if (!source) return undefined;
  return source.handles?.[sourceHandle ?? 'source'] ?? source.emits;
}

/**
 * 节点产出的标量值输出（数值/源节点 → 下游参数端口）。
 * 借鉴 ComfyUI 的 primitive 节点：一个源节点可 fan-out 给多个参数端口。
 */
export interface NodeValueOutput {
  socketType: SocketType;
  value: DynamicValue;
}

/**
 * 上游媒体 → 生成参数协议键的注入规则。
 * 协议键与对话模式 useTaskGeneration 完全一致，由 Electron runtime 统一消费。
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
  targetPorts: NodePorts | undefined,
  sourceHandle?: string | null,
): boolean {
  const emits = getSourcePortMediaKind(sourcePorts, sourceHandle);
  const accepts = targetPorts?.target?.accepts;
  if (!emits || !accepts || accepts.length === 0) {
    return false;
  }
  return accepts.includes(emits);
}
