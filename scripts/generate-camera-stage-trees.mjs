#!/usr/bin/env node
/* eslint-disable no-console -- 生成脚本，输出每种树的三角形数供核对。 */
/**
 * 生成镜头参考布景用的行道树模型：resources/camera-stage/street-trees.glb。
 *
 * 用 ez-tree（@dgreenheck/ez-tree，MIT，three.js 程序化树）按它自带的树种预设长出枝干，
 * 再把树叶的位置聚成几团、每团取凸包，做成低多边形树冠。镜头参考是纯色渲染，而且深度图、
 * 线稿图要用覆盖材质整场重画，透明贴图的树叶片在那两种画面里会变成一块块方片；凸包树冠在
 * 所有成像方式下都是实体。几千棵树实例化绘制，每棵树控制在几百个三角形。
 *
 * 只在换树种或调参数时手动运行，产物入库；运行时不依赖 ez-tree（它的包内嵌了约 4MB 贴图）。
 *
 * 用法：node scripts/generate-camera-stage-trees.mjs [输出路径]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

// ez-tree 在模块加载时就用 TextureLoader 读内嵌贴图；Node 里没有 DOM，换成空贴图（树皮与树叶贴图都用不到）。
THREE.TextureLoader.prototype.load = () => new THREE.Texture()
// GLTFExporter 的二进制输出要用 FileReader 读 Blob。
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((buffer) => { this.result = buffer; this.onloadend?.() })
  }
  readAsDataURL(blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
      this.onloadend?.()
    })
  }
}

const { Tree, TreePreset } = await import('@dgreenheck/ez-tree')
const { ConvexGeometry } = await import('three/examples/jsm/geometries/ConvexGeometry.js')
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js')

// 记下每根枝条占用的三角形区间与层级：树干与一级主枝露在树冠外面，更细的枝条都包在树冠凸包里，
// 只留前两层，每棵树的三角形少一大半。generateBranch 只写本枝条的几何，子枝条排进队列稍后处理。
const generateBranch = Tree.prototype.generateBranch
Tree.prototype.generateBranch = function recordBranch(branch) {
  const start = this.branches.indices.length
  generateBranch.call(this, branch)
  this.branchRanges ??= []
  this.branchRanges.push({ level: branch.level, start, end: this.branches.indices.length })
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(process.argv[2] ?? path.join(root, 'resources/camera-stage/street-trees.glb'))

/**
 * 树种：名称是运行时引用的模型名（与 stageSetProps.ts 的 STREET_TREE_VARIANTS 一致）。
 * height 是成树高（米），按国内与欧美城市行道树常见规格取 8–11 米；clear 是枝下高，
 * 行道树要让出人行道上的净空（2.5 米以上）。
 */
const VARIANTS = [
  { name: 'broadleaf', preset: 'Ash Medium', seed: 31, height: 9, clear: 2.6, clusters: 7, trunkLevels: 1 },
  { name: 'round', preset: 'Oak Medium', seed: 12, height: 8, clear: 2.5, clusters: 7, trunkLevels: 1 },
  { name: 'columnar', preset: 'Aspen Medium', seed: 7, height: 11, clear: 2.8, clusters: 6, trunkLevels: 1 },
  { name: 'conifer', preset: 'Pine Medium', seed: 5, height: 10, clear: 1.6, clusters: 6, trunkLevels: 0 },
]

/** 降低枝干分段：只留看得出树形的那几层，末端细枝的分段最贵、最看不清。 */
function lowPolyOptions(json) {
  const options = structuredClone(json)
  options.bark.textured = false
  options.branch.sections = { 0: 5, 1: 3, 2: 3, 3: 2 }
  options.branch.segments = { 0: 6, 1: 3, 2: 3, 3: 3 }
  return options
}

/** 确定性随机：凸包采样点用，保证同一份脚本总是生成同一份模型。 */
function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function kMeans(points, k, random) {
  const centers = []
  for (let index = 0; index < k; index += 1) centers.push(points[Math.floor(random() * points.length)].clone())
  const assignment = new Array(points.length).fill(0)
  for (let iteration = 0; iteration < 24; iteration += 1) {
    points.forEach((point, index) => {
      let best = 0
      let bestDistance = Infinity
      centers.forEach((center, centerIndex) => {
        const distance = center.distanceToSquared(point)
        if (distance < bestDistance) { best = centerIndex; bestDistance = distance }
      })
      assignment[index] = best
    })
    centers.forEach((center, centerIndex) => {
      const members = points.filter((_, index) => assignment[index] === centerIndex)
      if (members.length === 0) return
      center.set(0, 0, 0)
      for (const member of members) center.add(member)
      center.divideScalar(members.length)
    })
  }
  return centers.map((center, centerIndex) => ({ center, points: points.filter((_, index) => assignment[index] === centerIndex) }))
}

function buildVariant(variant) {
  const tree = new Tree()
  tree.loadFromJson(lowPolyOptions(TreePreset[variant.preset]))
  tree.options.seed = variant.seed
  tree.generate()
  const branches = tree.branchesMesh.geometry
  const leaves = tree.leavesMesh.geometry
  branches.computeBoundingBox()
  leaves.computeBoundingBox()
  const bounds = branches.boundingBox.clone().union(leaves.boundingBox)
  const scale = variant.height / (bounds.max.y - bounds.min.y)
  const matrix = new THREE.Matrix4().makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(0, -bounds.min.y, 0))

  const allIndices = branches.getIndex().array
  const kept = []
  for (const range of tree.branchRanges) {
    if (range.level <= variant.trunkLevels) for (let index = range.start; index < range.end; index += 1) kept.push(allIndices[index])
  }
  const trunk = new THREE.BufferGeometry()
  trunk.setAttribute('position', branches.getAttribute('position').clone())
  trunk.setAttribute('normal', branches.getAttribute('normal').clone())
  trunk.setIndex(kept)
  trunk.applyMatrix4(matrix)

  // 每片叶子 4 个顶点；树冠从叶子四角取点，低于枝下高的点抬到枝下高，人行道上方留出净空。
  const leafPositions = leaves.getAttribute('position')
  const corners = []
  for (let index = 0; index < leafPositions.count; index += 1) {
    const point = new THREE.Vector3().fromBufferAttribute(leafPositions, index).applyMatrix4(matrix)
    point.y = Math.max(point.y, variant.clear)
    corners.push(point)
  }
  const random = createRandom(variant.seed)
  const crowns = []
  for (const cluster of kMeans(corners, variant.clusters, random)) {
    if (cluster.points.length < 8) continue
    // 每团最多取 36 个点再求凸包：点越多面越碎，几千棵树时三角形数是主要开销。
    const sample = cluster.points.length <= 36 ? cluster.points
      : Array.from({ length: 36 }, () => cluster.points[Math.floor(random() * cluster.points.length)])
    // 向团中心外扩一点，凸包之间互相咬住，看不出缝。
    const expanded = sample.map(point => point.clone().sub(cluster.center).multiplyScalar(1.12).add(cluster.center))
    crowns.push(new ConvexGeometry(expanded))
  }
  const canopy = mergeGeometries(crowns)
  return { trunk: mergeVertices(trunk), canopy }
}

function mergeGeometries(geometries) {
  let count = 0
  for (const geometry of geometries) count += geometry.getAttribute('position').count
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  let offset = 0
  for (const geometry of geometries) {
    positions.set(geometry.getAttribute('position').array, offset * 3)
    normals.set(geometry.getAttribute('normal').array, offset * 3)
    offset += geometry.getAttribute('position').count
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  return merged
}

const scene = new THREE.Scene()
const material = new THREE.MeshStandardMaterial()
let triangles = 0
for (const variant of VARIANTS) {
  const { trunk, canopy } = buildVariant(variant)
  for (const [part, geometry] of [['trunk', trunk], ['canopy', canopy]]) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `tree-${variant.name}-${part}`
    scene.add(mesh)
    const tris = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3
    triangles += tris
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    console.log(`${mesh.name}: ${tris} 个三角形，范围 ${box.min.toArray().map(v => v.toFixed(2))} → ${box.max.toArray().map(v => v.toFixed(2))}`)
  }
}

const exporter = new GLTFExporter()
const buffer = await exporter.parseAsync(scene, { binary: true })
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, Buffer.from(buffer))
console.log(`已写出 ${output}（${(buffer.byteLength / 1024).toFixed(1)} KB，合计 ${triangles} 个三角形）`)
