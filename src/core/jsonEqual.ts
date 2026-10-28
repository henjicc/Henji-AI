/**
 * 两份 JSON 数据是否表示同一内容：先比引用，相同的子树不再展开，所以共享大部分节点的两份文档只比较换掉的部分。
 * 与比较 `JSON.stringify` 的结果一致，只是不计对象键的顺序：值为 undefined 的键视同缺省。
 * 只用于普通 JSON 数据（对象、数组、字符串、有限数字、布尔、null）。
 */
export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) if (!jsonEqual(left[index], right[index])) return false
    return true
  }
  const a = left as Record<string, unknown>; const b = right as Record<string, unknown>
  let keys = 0
  for (const key of Object.keys(a)) {
    if (a[key] === undefined) continue
    if (!Object.hasOwn(b, key) || !jsonEqual(a[key], b[key])) return false
    keys++
  }
  for (const key of Object.keys(b)) if (b[key] !== undefined) keys--
  return keys === 0
}
