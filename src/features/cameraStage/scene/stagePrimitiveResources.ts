import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three'
import type { StagePrimitiveKind } from '../domain/sceneTypes'

/**
 * 基础几何体的共享资源：同一个 Canvas 里同种几何体只建一份，同色同选中态的材质只建一份。
 *
 * 城市群这类上千个方块的场景，逐物体各建一份几何与材质时，渲染器每次绘制都要切换缓冲和材质
 * 状态，CPU 先成为瓶颈。资源按 Canvas 划分而不是全局共享：three 会在几何体、材质上挂各渲染器的
 * 释放监听，跨渲染器共享时，切换窗格重建 Canvas 后旧渲染器会一直被监听引用着。
 */

interface MaterialEntry {
  key: string
  material: MeshStandardMaterial
  users: number
}

function createPrimitiveGeometry(kind: StagePrimitiveKind): BufferGeometry {
  switch (kind) {
    case 'sphere':
      return new SphereGeometry(0.5, 32, 32)
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, 32)
    case 'cone':
      return new ConeGeometry(0.5, 1, 32)
    case 'pyramid':
      return new ConeGeometry(0.6, 1, 4)
    case 'torus':
      return new TorusGeometry(0.5, 0.2, 16, 48)
    case 'box':
    default:
      return new BoxGeometry(1, 1, 1)
  }
}

export class StagePrimitiveResources {
  private readonly geometries = new Map<StagePrimitiveKind, BufferGeometry>()
  private readonly materials = new Map<string, MaterialEntry>()
  private sweepTimer: ReturnType<typeof setTimeout> | null = null

  geometry(kind: StagePrimitiveKind): BufferGeometry {
    let geometry = this.geometries.get(kind)
    if (!geometry) {
      geometry = createPrimitiveGeometry(kind)
      this.geometries.set(kind, geometry)
    }
    return geometry
  }

  /** 渲染期只取不计数：被丢弃的渲染不会留下引用，计数在提交后的 effect 里加减。 */
  material(color: string, selected: boolean): MaterialEntry {
    const key = `${color}|${selected ? 1 : 0}`
    let entry = this.materials.get(key)
    if (!entry) {
      entry = {
        key,
        material: new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: selected ? 0.35 : 0 }),
        users: 0,
      }
      this.materials.set(key, entry)
    }
    return entry
  }

  retain(entry: MaterialEntry): void {
    entry.users += 1
    if (!this.materials.has(entry.key)) this.materials.set(entry.key, entry)
  }

  /** 拖动取色器会连续产生新颜色；没人用的材质延后统一释放，同一次提交里换用的材质不会被误删。 */
  release(entry: MaterialEntry): void {
    entry.users = Math.max(0, entry.users - 1)
    if (entry.users > 0 || this.sweepTimer !== null) return
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null
      for (const [key, candidate] of this.materials) {
        if (candidate.users > 0) continue
        this.materials.delete(key)
        candidate.material.dispose()
      }
    }, 0)
  }

  dispose(): void {
    if (this.sweepTimer !== null) clearTimeout(this.sweepTimer)
    this.sweepTimer = null
    for (const geometry of this.geometries.values()) geometry.dispose()
    for (const entry of this.materials.values()) entry.material.dispose()
    this.geometries.clear()
    this.materials.clear()
  }
}

const StagePrimitiveResourcesContext = createContext<StagePrimitiveResources | null>(null)

/** 放在 Canvas 内部：资源随这个 Canvas 的渲染器一起创建、一起释放。 */
export const StagePrimitiveResourcesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [resources] = useState(() => new StagePrimitiveResources())
  useEffect(() => () => resources.dispose(), [resources])
  return React.createElement(StagePrimitiveResourcesContext.Provider, { value: resources }, children)
}

export function useStagePrimitiveResources(): StagePrimitiveResources {
  const resources = useContext(StagePrimitiveResourcesContext)
  if (!resources) throw new Error('[cameraStage] 基础几何体必须渲染在 StagePrimitiveResourcesProvider 内')
  return resources
}

export function useStagePrimitiveMaterial(color: string, selected: boolean): MeshStandardMaterial {
  const resources = useStagePrimitiveResources()
  const entry = useMemo(() => resources.material(color, selected), [resources, color, selected])
  useEffect(() => {
    resources.retain(entry)
    return () => resources.release(entry)
  }, [resources, entry])
  return entry.material
}
