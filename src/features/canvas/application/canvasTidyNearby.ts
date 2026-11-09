import { Constraint, Expression, Operator, Solver, Strength, Variable } from '@lume/kiwi'

/**
 * 就近整理：把乱放的节点理整齐，但尽量留在原来的位置。
 *
 * 做法是“最小挪动 + 约束”：先认出用户本来想对齐的行（顶边差不多齐）和列（左边差不多齐），
 * 再交给 Cassowary 求解器（kiwi，与图层排版同一个）——对齐、顺序、不重叠是硬约束，
 * “离原位置近”是弱约束，求解器给出满足约束且总挪动最少的位置。重叠按 VPSC 的思路逐对补分隔约束，
 * 沿穿插更浅的方向推开，不改变两者原来的先后。挪得太远的节点放弃它的对齐，留在原处附近，
 * 保证效果不夸张。不再另做网格吸附：各自取整到网格会把刚统一好的间距打乱，整齐靠对齐与等距。
 */
export interface NearbyRect { x: number; y: number; width: number; height: number; locked: boolean }

/** 节点标题浮在卡片上方，行与行、节点与节点之间都要给它留位置；与按连线方向整理的间距一致 */
const GAP = 48
/** 不重叠时的最小间隙：比标准间距小，挤得很近的节点才会被推开 */
const MIN_GAP = 24
/** 原间隙在这个倍数以内视为“想挨着放”，统一成标准间距；更远的保持原来的距离 */
const NEAR_GAP_RATIO = 1.75
const MAX_OVERLAP_ROUNDS = 40

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** 按某条边聚类：与簇里第一个成员的差在容差内就算同一行（列）。容差随节点大小，避免把本来错开的两层并成一行。 */
function cluster(rects: readonly NearbyRect[], members: readonly number[], edge: (rect: NearbyRect) => number, tolerance: (a: NearbyRect, b: NearbyRect) => number): number[][] {
  const sorted = [...members].sort((a, b) => edge(rects[a]) - edge(rects[b]))
  const groups: number[][] = []
  for (const index of sorted) {
    const group = groups.at(-1)
    if (group && Math.abs(edge(rects[index]) - edge(rects[group[0]])) <= tolerance(rects[group[0]], rects[index])) group.push(index)
    else groups.push([index])
  }
  return groups.filter(group => group.length > 1)
}

function solve(rects: readonly NearbyRect[], obstacles: readonly NearbyRect[], aligned: ReadonlySet<number>): [number, number][] {
  const all = [...rects, ...obstacles.map(rect => ({ ...rect, locked: true }))]
  const solver = new Solver()
  const xs = all.map((_, i) => new Variable(`x${i}`))
  const ys = all.map((_, i) => new Variable(`y${i}`))
  const add = (expression: Expression, operator: Operator, strength: number): boolean => {
    try { solver.addConstraint(new Constraint(expression, operator, 0, strength)); return true } catch { return false }
  }
  all.forEach((rect, i) => {
    const strength = rect.locked ? Strength.required : Strength.weak
    add(new Expression(xs[i], -rect.x), Operator.Eq, strength)
    add(new Expression(ys[i], -rect.y), Operator.Eq, strength)
  })
  // 钉住的节点不动，但参与认行认列：别的节点向它看齐
  const movable = rects.map((_, i) => i).filter(i => aligned.has(i) || rects[i].locked)
  const rows = cluster(rects, movable, rect => rect.y, (a, b) => clamp(0.3 * Math.min(a.height, b.height), 16, 64))
  const columns = cluster(rects, movable, rect => rect.x, (a, b) => clamp(0.15 * Math.min(a.width, b.width), 16, 64))
  // 行：顶边对齐、左右顺序不变；原来就挨着的统一成标准间距
  for (const row of rows) {
    const ordered = [...row].sort((a, b) => rects[a].x - rects[b].x)
    ordered.slice(1).forEach((index, k) => {
      const prev = ordered[k]
      add(new Expression(ys[index], [-1, ys[prev]]), Operator.Eq, Strength.strong)
      add(new Expression(xs[index], [-1, xs[prev]], -rects[prev].width - MIN_GAP), Operator.Ge, Strength.required)
      const gap = rects[index].x - (rects[prev].x + rects[prev].width)
      if (gap < GAP * NEAR_GAP_RATIO) add(new Expression(xs[index], [-1, xs[prev]], -rects[prev].width - GAP), Operator.Eq, Strength.medium)
    })
  }
  // 列：左边对齐、上下顺序不变。已在同一行的一对（几乎重合的节点）只按行排，否则行列硬约束会把它沿对角线推远
  const rowOf = new Map(rows.flatMap((row, r) => row.map(index => [index, r] as const)))
  for (const column of columns) {
    const ordered = [...column].sort((a, b) => rects[a].y - rects[b].y)
    ordered.slice(1).forEach((index, k) => {
      const prev = ordered[k]
      if (rowOf.has(index) && rowOf.get(index) === rowOf.get(prev)) return
      add(new Expression(xs[index], [-1, xs[prev]]), Operator.Eq, Strength.strong)
      add(new Expression(ys[index], [-1, ys[prev]], -rects[prev].height - MIN_GAP), Operator.Ge, Strength.required)
      const gap = rects[index].y - (rects[prev].y + rects[prev].height)
      if (gap < GAP * NEAR_GAP_RATIO) add(new Expression(ys[index], [-1, ys[prev]], -rects[prev].height - GAP), Operator.Eq, Strength.medium)
    })
  }
  solver.updateVariables()
  // 逐对消除重叠：沿穿插更浅的方向、按原来的先后加一条分隔约束，再求解；这个方向放不下（两侧被钉住的节点或障碍夹住）就换另一个方向
  const separate = (first: number, second: number, axis: 'x' | 'y'): boolean => axis === 'x'
    ? add(new Expression(xs[second], [-1, xs[first]], -all[first].width - MIN_GAP), Operator.Ge, Strength.required)
    : add(new Expression(ys[second], [-1, ys[first]], -all[first].height - MIN_GAP), Operator.Ge, Strength.required)
  const order = (a: number, b: number, axis: 'x' | 'y'): [number, number] => axis === 'x'
    ? (all[a].x + all[a].width / 2 <= all[b].x + all[b].width / 2 ? [a, b] : [b, a])
    : (all[a].y + all[a].height / 2 <= all[b].y + all[b].height / 2 ? [a, b] : [b, a])
  const separated = new Set<string>()
  for (let round = 0; round < MAX_OVERLAP_ROUNDS; round++) {
    let changed = false
    // 按左边排序后只比较横向可能相交的一对，节点多时不必两两全比
    const byX = all.map((_, i) => i).sort((a, b) => xs[a].value() - xs[b].value())
    for (let p = 0; p < byX.length; p++) {
      const a = byX[p]
      const ax = xs[a].value(), ay = ys[a].value()
      for (let q = p + 1; q < byX.length; q++) {
        const b = byX[q]
        const bx = xs[b].value(), by = ys[b].value()
        if (bx >= ax + all[a].width + MIN_GAP) break
        if (all[a].locked && all[b].locked) continue
        const key = a < b ? `${a}:${b}` : `${b}:${a}`
        if (separated.has(key)) continue
        const overlapX = Math.min(ax + all[a].width, bx + all[b].width) - Math.max(ax, bx) + MIN_GAP
        const overlapY = Math.min(ay + all[a].height, by + all[b].height) - Math.max(ay, by) + MIN_GAP
        if (overlapX <= 0 || overlapY <= 0) continue
        const preferred: 'x' | 'y' = overlapX <= overlapY ? 'x' : 'y'
        const other: 'x' | 'y' = preferred === 'x' ? 'y' : 'x'
        const ok = separate(...order(a, b, preferred), preferred) || separate(...order(a, b, other), other)
        separated.add(key)
        changed = changed || ok
      }
    }
    if (!changed) break
    solver.updateVariables()
  }
  return rects.map((rect, i) => rect.locked ? [0, 0]
    : [Math.round(xs[i].value()) - rect.x, Math.round(ys[i].value()) - rect.y])
}

/** 两个矩形各向外扩 margin 后是否相交 */
const near = (a: NearbyRect, b: NearbyRect, margin: number): boolean =>
  a.x - margin < b.x + b.width && b.x - margin < a.x + a.width && a.y - margin < b.y + b.height && b.y - margin < a.y + a.height

/**
 * 离得远的节点之间既不对齐也不会相撞，按“挨得近”把节点分成几块分别求解：
 * 求解器的开销随约束数超线性增长，整张大画布放进一个求解器里会卡住界面。
 */
function neighbourhoods(rects: readonly NearbyRect[], margin: number): number[][] {
  const parent = rects.map((_, i) => i)
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]))
  const byX = rects.map((_, i) => i).sort((a, b) => rects[a].x - rects[b].x)
  for (let p = 0; p < byX.length; p++) {
    for (let q = p + 1; q < byX.length; q++) {
      const a = rects[byX[p]], b = rects[byX[q]]
      if (b.x - margin >= a.x + a.width + margin) break
      if (near(a, b, margin)) parent[find(byX[p])] = find(byX[q])
    }
  }
  const groups = new Map<number, number[]>()
  rects.forEach((_, i) => { const root = find(i); groups.set(root, [...(groups.get(root) ?? []), i]) })
  return [...groups.values()]
}

/** 返回每个节点的位移；锁定的节点不动，obstacles（选区外的节点）只参与避让。 */
export function nearbyTidyDeltas(rects: readonly NearbyRect[], obstacles: readonly NearbyRect[] = []): [number, number][] {
  const deltas: [number, number][] = rects.map(() => [0, 0])
  // 分块的范围要盖住“会被统一间距拉到一起”和“会被对齐”的距离
  for (const group of neighbourhoods(rects, GAP * NEAR_GAP_RATIO + 64)) {
    if (group.length === 1 && !obstacles.some(o => near(rects[group[0]], o, MIN_GAP))) continue
    const subset = group.map(i => rects[i])
    const box = subset.reduce((acc, r) => ({ x: Math.min(acc.x, r.x), y: Math.min(acc.y, r.y), right: Math.max(acc.right, r.x + r.width), bottom: Math.max(acc.bottom, r.y + r.height) }),
      { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity })
    const pad = 400
    const area: NearbyRect = { x: box.x - pad, y: box.y - pad, width: box.right - box.x + 2 * pad, height: box.bottom - box.y + 2 * pad, locked: true }
    const localObstacles = obstacles.filter(o => near(o, area, 0))
    const solved = solveWithCap(subset, localObstacles)
    group.forEach((index, k) => { deltas[index] = solved[k] })
  }
  return deltas
}

function solveWithCap(rects: readonly NearbyRect[], obstacles: readonly NearbyRect[]): [number, number][] {
  const aligned = new Set(rects.map((rect, i) => i).filter(i => !rects[i].locked))
  let deltas = solve(rects, obstacles, aligned)
  // 为了对齐挪得太远的节点放弃对齐，只做避让：整理要的是理顺，不是重排
  const tooFar = deltas.map(([dx, dy], i) => Math.hypot(dx, dy) > Math.max(320, 1.5 * Math.max(rects[i].width, rects[i].height)))
  if (tooFar.some(Boolean)) {
    tooFar.forEach((far, i) => { if (far) aligned.delete(i) })
    deltas = solve(rects, obstacles, aligned)
  }
  return deltas
}
