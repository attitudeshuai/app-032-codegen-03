/**
 * 材料统计与备料单（规格书 §4.6 / §5）
 * 备料按含余量长度；批量 = 单灯 × N × (1 + 损耗率)。
 * 重量（g/kg）与竹篾长度均取自选型结论重建的构件行（四处同一组数），不另算一套截面。
 */
import type { FrameMember, Lantern } from './types'
import { bodySurfaceArea, bodyVolume, r1, r3 } from './geometry'
import { buildFrame } from './frame'
import { buildPanels } from './panels'
import { BAMBOO, coveringSpec, CRAFT } from './craft'

export interface SingleLightMaterials {
  /** 竹篾备料总长（含绑扎余量，m） */
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
  /** 竹篾骨架自重（g） */
  bambooMassG: number
  /** 蒙面重量（g） */
  coveringMassG: number
  /** 扎线重量（g） */
  lashMassG: number
  /** LED 含线重量（g） */
  ledMassG: number
  /** 灯体总重（g） */
  totalMassG: number
  /** 灯体总重（kg） */
  totalMassKg: number
  /** 按选型截面分组的竹篾用量（截取总长 m / 重量 g） */
  byGrade: { gradeId: string; gradeName: string; widthMm: number; thicknessMm: number; stockM: number; massG: number }[]
}

export interface BatchMaterials extends SingleLightMaterials {
  count: number
  wasteRatio: number
}

export function computeMaterials(l: Lantern): SingleLightMaterials {
  const frame = buildFrame(l)
  const panelRes = buildPanels(l)
  const cov = coveringSpec(l.covering)
  const divisions = Math.max(3, Math.round(l.divisions))

  const frameMm = frame.members.reduce((s, m: FrameMember) => s + m.lengthMm * m.qty, 0)
  const frameRawMm = frame.members.reduce((s, m: FrameMember) => s + m.rawLengthMm * m.qty, 0)
  const joints = frame.members.reduce((s, m: FrameMember) => s + m.qty * m.lashJoints, 0)
  const cutArea = panelRes.cutAreaMm2
  const volumeL = bodyVolume(frame.geometry) / 1_000_000
  const led = Math.max(CRAFT.led.min, Math.ceil(volumeL * CRAFT.led.perLiter))

  // 重量：直接取选型结论（与自检/逐层受力是同一套账）
  const sizing = frame.sizing
  const bambooG = sizing.mass.bambooG
  const coveringG = sizing.mass.coveringG
  const lashG = sizing.mass.lashG
  const ledG = sizing.mass.ledG
  const totalG = bambooG + coveringG + lashG + ledG

  // 按截面档分组备料（每根篾截取长度 × 数量）
  const gradeMap = new Map<string, SingleLightMaterials['byGrade'][number]>()
  for (const m of frame.members) {
    if (!m.gradeId || m.kind === 'spoke') continue
    const cur =
      gradeMap.get(m.gradeId) || {
        gradeId: m.gradeId,
        gradeName: m.gradeName || '',
        widthMm: m.widthMm || 0,
        thicknessMm: m.thicknessMm || 0,
        stockM: 0,
        massG: 0
      }
    cur.stockM += (m.lengthMm * m.qty) / 1000
    cur.massG += m.lengthMm * m.qty * m.widthMm! * m.thicknessMm! * BAMBOO.densityGPerMm3
    gradeMap.set(m.gradeId, cur)
  }
  const byGrade = [...gradeMap.values()].map((x) => ({
    ...x,
    stockM: r3(x.stockM),
    massG: Math.round(x.massG * 10) / 10
  }))

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
    bambooMassG: Math.round(bambooG * 10) / 10,
    coveringMassG: Math.round(coveringG * 10) / 10,
    lashMassG: Math.round(lashG * 10) / 10,
    ledMassG: Math.round(ledG * 10) / 10,
    totalMassG: Math.round(totalG * 10) / 10,
    totalMassKg: Math.round(totalG / 100) / 10,
    byGrade
  }
}

// 表面积已在上方直接取自 geometry（与既有面积核对同源）

/** 批量化：单灯 × N × (1 + 损耗率)；LED 按颗数 × N（不参与损耗率）；重量同比例折算 */
export function computeBatch(single: SingleLightMaterials, count: number, wasteRatio: number): BatchMaterials {
  const k = count * (1 + wasteRatio)
  const batchTotalG =
    Math.round((single.bambooMassG + single.coveringMassG + single.lashMassG) * k * 10 + single.ledMassG * count * 10) / 10
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
    bambooMassG: Math.round(single.bambooMassG * k * 10) / 10,
    coveringMassG: Math.round(single.coveringMassG * k * 10) / 10,
    lashMassG: Math.round(single.lashMassG * k * 10) / 10,
    ledMassG: Math.round(single.ledMassG * count * 10) / 10,
    totalMassG: batchTotalG,
    totalMassKg: Math.round((batchTotalG / 1000) * 100) / 100,
    byGrade: single.byGrade.map((g) => ({
      ...g,
      stockM: r3(g.stockM * k),
      massG: Math.round(g.massG * k * 10) / 10
    })),
    volumeL: r3(single.volumeL * count),
    ledCount: single.ledCount * count,
    surfaceM2: r3(single.surfaceM2 * count)
  }
}
