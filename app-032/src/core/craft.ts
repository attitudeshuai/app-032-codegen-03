/** 本地打包的灯型库与工艺参数（断网可用，无运行期外部请求） */
import raw from '../data/lantern-types.json'
import type { Covering } from './types'

export interface CoveringSpec {
  id: Covering
  name: string
  gluePerM2: number
  /** 蒙面材料面密度 g/m²（含胶前） */
  weightGPerM2: number
  wasteRatio: number
  color: string
  note: string
}

/** 竹篾规格档（目录 7 档，宽厚单位 mm） */
export interface BambooGrade {
  id: string
  name: string
  widthMm: number
  thicknessMm: number
  /** 作坊经验：该档净跨超过此值就容易下塌（mm） */
  maxSpanMm: number
  note: string
}

export interface BambooCraft {
  /** 干燥毛竹密度 g/mm³（= 0.72 g/cm³） */
  densityGMm3: number
  /** 顺纹抗弯弹性模量 N/mm² */
  elasticModulusNmm2: number
  /** 许用弯曲应力 N/mm²（作坊经验安全值） */
  allowableBendNmm2: number
  /** 荷载安全系数（蒙面绷紧与手拎冲击） */
  loadSafety: number
  /** 挠度限值 = 净跨 / sagDivisor */
  sagDivisor: number
  /** 蒙面/扎线等外载在竖篾与横篾圈之间的分摊比例（竖篾侧） */
  ribLoadShare: number
  /** 最小弯弧半径 = bendRadiusFactor × 篾厚（热弯经验） */
  bendRadiusFactor: number
  /** 扎线线密度 g/m */
  threadGPerM: number
  /** 单颗 LED（含灯座导线）重量 g */
  ledGramEach: number
  /** g → N */
  gForce: number
  /** 每层最多允许补几道横篾圈 */
  maxExtraRingsPerBand: number
  grades: BambooGrade[]
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
  led: { perLiter: number; min: number; rule: string }
}

export const COVERINGS = raw.coverings as CoveringSpec[]
export const PRESETS = raw.presets as LanternPreset[]
export const BAMBOO = raw.bamboo as BambooCraft

/** 单根篾线密度 g/mm（矩形截面：宽厚mm × 密度g/mm³） */
export function bambooLinearGPerMm(g: BambooGrade): number {
  return g.widthMm * g.thicknessMm * BAMBOO.densityGMm3
}

export function gradeById(id: string): BambooGrade {
  return BAMBOO.grades.find((x) => x.id === id) || BAMBOO.grades[0]
}

export function gradeIndex(id: string): number {
  return Math.max(0, BAMBOO.grades.findIndex((x) => x.id === id))
}

/** 截面模量 Z = b·t²/6（mm³），横篾圈在自身平面内受弯、竖篾下塌均用厚向 */
export function sectionModulus(g: BambooGrade): number {
  return (g.widthMm * g.thicknessMm * g.thicknessMm) / 6
}

/** 截面惯性矩 I = b·t³/12（mm⁴） */
export function sectionInertia(g: BambooGrade): number {
  return (g.widthMm * g.thicknessMm ** 3) / 12
}

/** 该档最小可弯半径 mm（热弯经验 = 系数 × 厚） */
export function minBendRadius(g: BambooGrade): number {
  return BAMBOO.bendRadiusFactor * g.thicknessMm
}

/** 预览图上按篾厚绘制的线宽与配色（1:1 mm 坐标系，线宽即篾厚；最细给到 0.6mm 保证可见） */
export function gradeStroke(g: BambooGrade): { widthMm: number; color: string } {
  const colors = ['#7fa8c9', '#5b8db5', '#3f74a3', '#2f5f8a', '#8a5a1d', '#6d4416', '#55330f']
  const k = Math.max(0, BAMBOO.grades.findIndex((x) => x.id === g.id))
  return { widthMm: Math.max(0.6, g.thicknessMm), color: colors[k] || '#2f5f8a' }
}

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
