/**
 * 材料统计与备料单（规格书 §4.6 / §5）
 * 备料按含余量长度；批量 = 单灯 × N × (1 + 损耗率)。
 * 竹篾截面、补加圈道数、骨架自重全部取自选型核定结论（frame.selection），不在此处另算。
 */
import type { Lantern } from './types'
import { bodySurfaceArea, bodyVolume, r1, r3 } from './geometry'
import { buildFrame } from './frame'
import { buildPanels } from './panels'
import { CRAFT, coveringSpec } from './craft'
import type { GradeLength, LedgerBand, RingLoadRow } from './selection'

export interface SingleLightMaterials {
  /** 竹篾/铁丝备料总长（含绑扎余量，m） */
  frameM: number
  /** 全部构件净长（m） */
  frameRawM: number
  /** 蒙面面积（含缝份，m²） */
  coveringM2: number
  /** 蒙面净面积（不含缝份，m²） */
  coveringNetM2: number
  /** 扎线（m） */
  lashM: number
  /** 胶（g） */
  glueG: number
  /** 绑扎处数 */
  lashJoints: number
  /** 灯体体积（L） */
  volumeL: number
  /** LED 建议颗数（不做电气设计，仅数量建议） */
  ledCount: number
  /** 灯体表面积（m²） */
  surfaceM2: number
  /** 竹篾骨架自重（g，按选型截面与含余量截取长度） */
  frameMassG: number
  /** 蒙面材料重（g，含缝份面积 × 面密度） */
  coveringMassG: number
  /** 扎线重（g） */
  threadMassG: number
  /** LED 重（g） */
  ledMassG: number
  /** 整灯总重（g） */
  totalMassG: number
  /** 整灯总重（kg） */
  totalMassKg: number
  /** 整灯总重换算（N） */
  totalWeightN: number
  /** 按规格档分列的用料 */
  gradeLengths: GradeLength[]
  /** 逐层受力账 */
  bandLedger: LedgerBand[]
  /** 各圈节点受力 */
  ringLoads: RingLoadRow[]
  /** 圈自重合计 g */
  ringSelfG: number
  capTopG: number
  capBottomG: number
}

export interface BatchMaterials extends SingleLightMaterials {
  count: number
  wasteRatio: number
}

export function computeMaterials(l: Lantern): SingleLightMaterials {
  const frame = buildFrame(l)
  const sel = frame.selection
  const panelRes = buildPanels(l)
  const cov = coveringSpec(l.covering)
  const divisions = Math.max(3, Math.round(l.divisions))

  const frameMm = sel.stockLengthMm
  const frameRawMm = sel.rawLengthMm
  const joints = frame.members.reduce((s, m) => s + m.qty * m.lashJoints, 0)
  const cutArea = panelRes.cutAreaMm2
  const volumeL = frame.geometry.kind === 'polyhedron' ? 0 : bodyVolume(frame.geometry) / 1_000_000
  const led = sel.polyMode
    ? CRAFT.led.min
    : Math.max(CRAFT.led.min, Math.ceil(volumeL * CRAFT.led.perLiter))

  const coveringMassG = (cutArea / 1_000_000) * cov.weightGPerM2
  const threadMassG = joints * CRAFT.lashPerJointM * 0.4

  return {
    frameM: r3(frameMm / 1000),
    frameRawM: r3(frameRawMm / 1000),
    coveringM2: r3(cutArea / 1_000_000),
    coveringNetM2: r3(panelRes.netAreaMm2 / 1_000_000),
    lashM: r3(joints * CRAFT.lashPerJointM),
    glueG: r1((cutArea / 1_000_000) * cov.gluePerM2),
    lashJoints: joints,
    volumeL: r3(volumeL),
    ledCount: led,
    surfaceM2: r3(bodySurfaceArea(frame.geometry, divisions) / 1_000_000),
    frameMassG: sel.frameMassG,
    coveringMassG,
    threadMassG,
    ledMassG: led * 1.2,
    totalMassG: sel.ledger.totalG,
    totalMassKg: sel.ledger.totalKg,
    totalWeightN: sel.ledger.totalN,
    gradeLengths: sel.gradeLengths,
    bandLedger: sel.ledger.bands,
    ringLoads: sel.ringLoads,
    ringSelfG: sel.ledger.ringSelfG,
    capTopG: sel.ledger.capTopG,
    capBottomG: sel.ledger.capBottomG
  }
}

/** 批量化：单灯 × N × (1 + 损耗率)；LED 按颗数 × N（不参与损耗率）。重量保留全精度，界面四舍五入显示 */
export function computeBatch(single: SingleLightMaterials, count: number, wasteRatio: number): BatchMaterials {
  const k = count * (1 + wasteRatio)
  return {
    ...single,
    count,
    wasteRatio,
    frameM: r3(single.frameM * k),
    frameRawM: r3(single.frameRawM * k),
    coveringM2: r3(single.coveringM2 * k),
    coveringNetM2: r3(single.coveringNetM2 * k),
    lashM: r3(single.lashM * k),
    glueG: r1(single.glueG * k),
    volumeL: r3(single.volumeL * count),
    ledCount: single.ledCount * count,
    surfaceM2: r3(single.surfaceM2 * count),
    frameMassG: single.frameMassG * k,
    coveringMassG: single.coveringMassG * k,
    threadMassG: single.threadMassG * k,
    ledMassG: single.ledMassG * count,
    totalMassG: single.totalMassG * k,
    totalMassKg: single.totalMassKg * k,
    totalWeightN: single.totalWeightN * k,
    ringSelfG: single.ringSelfG * k,
    capTopG: single.capTopG * k,
    capBottomG: single.capBottomG * k
  }
}
