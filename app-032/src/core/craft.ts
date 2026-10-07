/** 本地打包的灯型库与工艺参数（断网可用，无运行期外部请求） */
import raw from '../data/lantern-types.json'
import type { Covering } from './types'

export interface CoveringSpec {
  id: Covering
  name: string
  gluePerM2: number
  /** 蒙面克重（g/m²） */
  massPerM2: number
  wasteRatio: number
  color: string
  note: string
}

/** 竹篾规格档：截面宽×厚（mm，1 位小数） */
export interface BambooGrade {
  id: string
  name: string
  widthMm: number
  thicknessMm: number
}

export interface BambooCraft {
  /** 竹材密度（g/mm³ ≈ 0.75g/cm³） */
  densityGPerMm3: number
  /** 许用弯曲应力（N/mm² ≈ MPa，顺纹弯） */
  allowableBendingNPerMm2: number
  /** 顺纹抗弯弹性模量（N/mm²） */
  elasticModulusNPerMm2: number
  /** 许用弯形应变（冷弯；t ≤ ε·R），适用于灯身圆肚圈 */
  allowableStrain: number
  /** 口部圈经加湿/加热后的许用弯形应变（上口圈专用） */
  allowableStrainMouth: number
  /** 挠度限值系数：δ ≤ L / deflectionRatio */
  deflectionRatio: number
  /** 蒙面竖向荷载分给竖篾的比例（其余落在横篾圈上） */
  coverLoadShareToRibs: number
  gravity: number
  maxCourses: number
  /** 扎线每米重量（g/m） */
  lashMassPerM: number
  grades: BambooGrade[]
}

export const BAMBOO = raw.bamboo as BambooCraft

export function bambooGrade(id: string): BambooGrade {
  return BAMBOO.grades.find((g) => g.id === id) || BAMBOO.grades[0]
}

export interface PresetParams {
  maxDiameterMm: number
  totalHeightMm: number
  mouthDiameterMm: number
  baseDiameterMm: number
  sides: number
  layerCount: number
  mouthStyle: 'flat' | 'taper' | 'gourd'
  bottomStyle: 'flat' | 'taper' | 'gourd'
  smoothness: number
  divisions?: number
  ctrl1?: { x: number; y: number }
  ctrl2?: { x: number; y: number }
  covering: Covering
  layerColors: string[]
  color: string
}

export interface LanternPreset {
  id: string
  name: string
  kind: 'prism' | 'revolution' | 'polyhedron' | 'box'
  tagline: string
  description: string
  params: PresetParams
}

export const CRAFT = raw.craft as {
  defaultLashAllowanceMm: number
  defaultSeamAllowanceMm: number
  defaultOverlapMm: number
  defaultDivisions: number
  divMin: number
  divMax: number
  lashPerJointM: number
  led: { perLiter: number; min: number; massPerUnitG: number; rule: string }
}

export const COVERINGS = raw.coverings as CoveringSpec[]
export const PRESETS = raw.presets as LanternPreset[]

export function coveringSpec(id: Covering): CoveringSpec {
  return COVERINGS.find((c) => c.id === id) || COVERINGS[0]
}

export function presetById(id: string): LanternPreset | undefined {
  return PRESETS.find((p) => p.id === id)
}

export const KIND_LABELS: Record<string, string> = {
  prism: '正多棱柱',
  revolution: '旋转体',
  polyhedron: '多面体',
  box: '方形走马灯'
}

export const STYLE_LABELS: Record<string, string> = {
  flat: '平口',
  taper: '收口',
  gourd: '葫芦口'
}

export const COVERING_LABELS: Record<string, string> = {
  xuan: '宣纸',
  silk: '绸布',
  parchment: '羊皮纸'
}

export function kindLabel(k: string): string {
  return KIND_LABELS[k] || k
}

export function styleLabel(s: string): string {
  return STYLE_LABELS[s] || s
}

export function coveringLabel(c: string): string {
  return COVERING_LABELS[c] || c
}
