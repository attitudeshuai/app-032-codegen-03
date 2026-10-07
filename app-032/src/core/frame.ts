/**
 * 骨架构件表（规格书 §4.3）
 * 构件行、净长、绑扎余量、宽厚截面、补加圈道数全部由选型核定（selection.ts）统一给出，
 * 本模块只负责类型映射、分组与汇总——选型结论是唯一来源，避免两处各算一遍。
 * lengthMm（含余量）用于备料，rawLengthMm（净长）用于核对。
 */
import type { FrameMember, Lantern } from './types'
import { r1, type Geometry } from './geometry'
import { computeSelection, type GradedRow, type SelectionResult } from './selection'

export interface FrameResult {
  geometry: Geometry
  members: FrameMember[]
  /** 构件总根数 */
  totalQty: number
  /** 备料总长（含余量，mm） */
  stockLengthMm: number
  /** 净长合计（mm） */
  rawLengthMm: number
  /** 全部绑扎余量合计（mm） */
  lashExtraMm: number
  /** 选型核定结果（四处共用） */
  selection: SelectionResult
}

function toMember(r: GradedRow, seq: { n: number }): FrameMember {
  seq.n++
  return {
    id: `FM${String(seq.n).padStart(3, '0')}`,
    kind: r.kind,
    label: r.label,
    rawLengthMm: r1(r.rawMm),
    lengthMm: r1(r.lengthMm),
    qty: r.qty,
    lashJoints: r.lashJoints,
    bendRadiusMm: r.bendRadiusMm,
    bendAngleDeg: r.bendAngleDeg,
    group: r.group,
    gradeId: r.grade.id,
    widthMm: r1(r.grade.widthMm),
    thicknessMm: r1(r.grade.thicknessMm),
    layerIndex: r.bandIndex,
    extraCourse: r.extraCourse,
    massEachG: Math.round(r.massEachG * 10) / 10,
    note: r.note
  }
}

/** 按选型结论重建构件行（宽厚/道数换结论就整表重建） */
export function buildFrame(l: Lantern): FrameResult {
  const sel = computeSelection(l)
  const seq = { n: 0 }
  const members = sel.rows.map((r) => toMember(r, seq))
  return {
    geometry: sel.geometry,
    members,
    totalQty: members.reduce((s, m) => s + m.qty, 0),
    stockLengthMm: r1(sel.stockLengthMm),
    rawLengthMm: r1(sel.rawLengthMm),
    lashExtraMm: r1(sel.stockLengthMm - sel.rawLengthMm),
    selection: sel
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
