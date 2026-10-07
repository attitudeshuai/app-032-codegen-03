/**
 * 骨架构件表（规格书 §4.3）
 * 构件行按竹篾选型核定结论重建：净长/接头余量取自 layout（轮廓与棱长周长、
 * 骨架构件与绑扎余量两处既有数），宽厚/道数取自 SizingResult 的同一组数。
 * lengthMm（含余量）用于备料，rawLengthMm（净长）用于核对。
 */
import type { FrameMember, Lantern } from './types'
import { r1, type Geometry } from './geometry'
import { computeSizing, type SizingResult } from './sizing'

export interface FrameResult {
  geometry: Geometry
  members: FrameMember[]
  /** 选型核定结论（截面/道数的同一组数来源） */
  sizing: SizingResult
  /** 构件总根数 */
  totalQty: number
  /** 备料总长（含余量，mm） */
  stockLengthMm: number
  /** 净长合计（mm） */
  rawLengthMm: number
  /** 全部绑扎余量合计（mm） */
  lashExtraMm: number
}

export function buildFrame(l: Lantern): FrameResult {
  const sizing = computeSizing(l)
  const members = sizing.members
  return summarize(sizing.layout.geometry, members, sizing)
}

function summarize(geometry: Geometry, members: FrameMember[], sizing: SizingResult): FrameResult {
  let totalQty = 0
  let stockLengthMm = 0
  let rawLengthMm = 0
  for (const m of members) {
    totalQty += m.qty
    stockLengthMm += m.lengthMm * m.qty
    rawLengthMm += m.rawLengthMm * m.qty
  }
  return {
    geometry,
    members,
    sizing,
    totalQty,
    stockLengthMm: r1(stockLengthMm),
    rawLengthMm: r1(rawLengthMm),
    lashExtraMm: r1(stockLengthMm - rawLengthMm)
  }
}

/** 构件按分组归并（构件表按类别分组展示） */
export function groupMembers(members: FrameMember[]): { group: string; items: FrameMember[] }[] {
  const order: string[] = []
  const map = new Map<string, FrameMember[]>()
  for (const m of members) {
    if (!map.has(m.group)) {
      map.set(m.group, [])
      order.push(m.group)
    }
    map.get(m.group)!.push(m)
  }
  return order.map((g) => ({ group: g, items: map.get(g)! }))
}
