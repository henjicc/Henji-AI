export type {
  ConnectionRejectionReason,
  ParamConnectionValidationResult,
  VisibleMediaInputPort,
} from './graphMediaPortResolver';
export {
  getDeclaredSourceMediaKind,
  resolveConnectionSourceMediaKind,
  resolveVisibleMediaInputPorts,
  sourceEmitsMediaKind,
} from './graphMediaPortResolver';
export {
  collectInputValues,
  getConnectedParamIds,
} from './graphParamValueResolver';
export {
  canSourceTypeConnectToTargetHandle,
  findStaleParamEdgeIds,
  isParamConnectionCompatible,
  resolveCompatibleTargetHandleForSource,
  validateParamConnection,
} from './graphConnectionValidation';
export type { VisibleSchemaParamRows } from './graphValueSchema';
export {
  findParamForTargetNode,
  getSchemaMediaParamKind,
  resolveVisibleSchemaParamRows,
} from './graphValueSchema';

/** 字符串集合内容相等比较（供 store selector 避免无效重渲染） */
export function areStringSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) {
    return true;
  }
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

/** 覆盖表内容相等比较（供 store selector 避免无效重渲染） */
export function areValueOverridesEqual(
  a: DynamicValueMap,
  b: DynamicValueMap
): boolean {
  if (a === b) {
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key) => Object.is(a[key], b[key]));
}
