/**
 * 竹篾规格选型核定（骨架承重选型）
 *
 * 数据纪律：本模块不重新量任何尺寸。
 *  - 竖篾/母线篾净长、弯折处半径 → geometry 的轮廓采样（buildGeometry/radiusAtY/segmentInfos）
 *  - 横篾圈周长、棱长、跨度 → polygonEdge / TAU（与构件表同一公式）
 *  - 绑扎余量、接头处数 → lashAllowanceMm 与「圆 1 处 / 多边形 n 处」旧规则
 *  - 逐层高度、上口收分 → l.layers / mouthDiameter / smoothness（同一份灯样参数）
 *  - 蒙面与胶重量 → panels 的裁片面积（含缝份）与 craft 的面密度
 * 构件表（frame.ts）只把这里算出的「构件计划行」挂上截面与分组，不再各算一遍。
 *
 * 单位：长度 mm（1 位小数展示，内部全精度）；力 N（g × 0.00980665）；重量 g / kg。
 */
import type { ExportRecord, Lantern, MemberKind, StripSelection } from './types'
import {
  buildGeometry,
  polygonEdge,
  polyhedronInfo,
  radiusAtY,
  segmentInfos,
  TAU,
  type Geometry
} from './geometry'
import { buildPanels, panelCutArea } from './panels'
import { bodyVolume } from './geometry'
import {
  BAMBOO,
  bambooLinearGPerMm,
  coveringSpec,
  gradeById,
  gradeIndex,
  minBendRadius,
  sectionInertia,
  sectionModulus,
  type BambooGrade
} from './craft'
import { CRAFT } from './craft'

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

export type GradeSelector = 'rib' | `ring:${number}`

/** 一次选型配置（任何模式最终都归一成它，供构件表/材料/预览共用） */
export interface SelectionConfig {
  mode: StripSelection['mode']
  ribGrade: string
  /** 各圈节点档（长度 = 层数 + 1，底盘 → 收口；多面体为空） */
  ringGrades: string[]
  /** 每一层（band）补加横篾圈道数（长度 = 层数；多面体为空） */
  extraRings: number[]
}

/** 构件计划行：长度全部来自轮廓与绑扎余量，frame.ts 只挂截面 */
export interface PlanRow {
  key: string
  kind: MemberKind
  label: string
  group: string
  qty: number
  rawMm: number
  lengthMm: number
  lashJoints: number
  bendRadiusMm?: number
  bendAngleDeg?: number
  /** 圈所在节点（0..L）；竖篾/棱篾/机构为 -1 */
  nodeIndex: number
  /** 所属层（横篾圈取其下方层；竖篾为 -1） */
  bandIndex: number
  /** 0 = 原有圈，1.. = 补加道序 */
  extraCourse: number
  /** 取截面档的选择子 */
  selector: GradeSelector
  note: string
}

export interface LashingPoint {
  y: number
  r: number
  /** 所属圈节点序号（含补加圈的虚拟节点） */
  node: number
  /** 0 原有节点，1.. 补加 */
  course: number
  /** 位于哪一层 */
  band: number
}

export interface MemberDemand {
  key: string
  label: string
  member: 'rib' | 'ring' | 'edge'
  selector: GradeSelector
  gradeId: string
  bandIndex: number
  nodeIndex: number
  /** 净跨（mm）：圈为相邻竖篾间弦长，竖篾为相邻绑扎点间折线跨 */
  spanMm: number
  /** 该跨承担荷载（N） */
  loadN: number
  /** 弯曲应力 N/mm²（含安全系数） */
  stressNmm2: number
  /** 挠度 mm */
  sagMm: number
  sagLimitMm: number
  /** 弯弧需求半径 mm（折角型多边形圈为 undefined＝折角不按弯弧考核） */
  bendRNeedMm?: number
  bendRLimitMm: number
  /** 轴向应力（竖篾吊挂/承压，N/mm²） */
  tensionNmm2: number
  ratios: { span: number; stress: number; sag: number; bend: number; tension: number }
  /** 主拦因 */
  reason: FailureReason
  pass: boolean
}

export type FailureReason = 'span' | 'weight' | 'bend' | null

export interface Failure {
  member: MemberDemand
  reason: Exclude<FailureReason, null>
  /** 人话：跨度太长 / 重量太大 / 弯得太急 */
  reasonText: string
  detail: string
}

export interface Remedy {
  id: 'thicker' | 'extraRing'
  title: string
  feasible: boolean
  /** 走完是否当场通过 */
  residualPass: boolean
  /** 材料代价 */
  costMaterial: string
  /** 加工代价 */
  costCraft: string
  /** 不能解决本次拦因时说明 */
  cannotFix?: string
  /** 应用后的配置 */
  config: SelectionConfig
}

export interface LedgerBand {
  bandIndex: number
  heightMm: number
  /** 该层蒙面（含缝份）+ 胶 */
  coverGlueG: number
  /** 该层摊到的 LED（含灯座导线） */
  ledG: number
  /** 该层摊到的扎线（层上的圈节点接头 + 竖篾跨） */
  threadG: number
  /** 该层竖篾自重 */
  ribSelfG: number
  /** 该层合计（不含横篾圈自重，圈单列，避免重复） */
  subtotalG: number
}

export interface RingLoadRow {
  nodeIndex: number
  label: string
  radiusMm: number
  extraCourse: number
  ringSelfG: number
  threadG: number
  coverShareG: number
  capG: number
  totalG: number
  totalN: number
  spanMm: number
}

export interface GradeLength {
  grade: BambooGrade
  lengthMm: number
  massG: number
  qty: number
}

export interface ModeSummary {
  mode: SelectionConfig['mode']
  config: SelectionConfig
  pass: boolean
  frameMm: number
  frameMassG: number
  /** 用到几种档 */
  distinctGrades: number
  /** 总圈道数（含补加） */
  ringCourses: number
  failures: Failure[]
}

export interface SelectionSnapshot {
  revision: number
  signature: string
  confirmedAt: string
  mode: SelectionConfig['mode']
  ribGrade: string
  ringGrades: string[]
  extraRings: number[]
  frameMm: number
  frameRawMm: number
  frameMassG: number
  covering: Lantern['covering']
  coveringM2: number
  members: { label: string; gradeId: string; widthMm: number; thicknessMm: number; extraCourse: number; lengthTotalMm: number }[]
  gradeLengths: Record<string, number>
  layerRings: { band: number; bottomNodeGrade: string; topNodeGrade: string; extras: number }[]
  checks: { c9: boolean; c10: boolean; c11: boolean }
}

export interface SelectionDiff {
  paramChanges: string[]
  memberChanges: string[]
  materialChanges: string[]
  previewChanges: string[]
  checkFlips: string[]
}

export interface SelectionResult {
  l: Lantern
  geometry: Geometry
  config: SelectionConfig
  recommended: SelectionConfig
  plan: PlanRow[]
  rows: GradedRow[]
  demands: MemberDemand[]
  failures: Failure[]
  pass: boolean
  remedies: Remedy[]
  ledger: { bands: LedgerBand[]; capTopG: number; capBottomG: number; threadG: number; ringSelfG: number; totalG: number; totalKg: number; totalN: number }
  ringLoads: RingLoadRow[]
  gradeLengths: GradeLength[]
  frameMassG: number
  stockLengthMm: number
  rawLengthMm: number
  lashPoints: LashingPoint[]
  modes: { uniform: ModeSummary; perlayer: ModeSummary }
  stale: boolean
  currentSignature: string
  baseline: SelectionSnapshot | null
  diff: SelectionDiff | null
  abandonedPathNote: string
  exports: ExportRecord[]
  polyMode: boolean
}

export interface GradedRow extends PlanRow {
  grade: BambooGrade
  massEachG: number
  massTotalG: number
}

/* ------------------------------------------------------------------ */
/* 灯样参数指纹（改了最大直径/蒙面等就对不上）                            */
/* ------------------------------------------------------------------ */

export function paramSignature(l: Lantern): string {
  const parts = [
    l.kind,
    l.maxDiameterMm,
    l.totalHeightMm,
    l.mouthDiameterMm,
    l.baseDiameterMm,
    l.sides,
    l.mouthStyle,
    l.bottomStyle,
    l.smoothness,
    l.divisions,
    l.covering,
    l.seamAllowanceMm,
    l.lashAllowanceMm,
    l.layers.map((x) => x.heightMm.toFixed(1)).join('/'),
    l.ctrl1.x.toFixed(3),
    l.ctrl1.y.toFixed(3),
    l.ctrl2.x.toFixed(3),
    l.ctrl2.y.toFixed(3)
  ]
  return parts.join('|')
}

/* ------------------------------------------------------------------ */
/* 灯样上的选型状态                                                     */
/* ------------------------------------------------------------------ */

export function ensureSelectionState(l: Lantern): StripSelection {
  if (!l.selection) {
    l.selection = {
      mode: 'uniform',
      ribGrade: '',
      ringGrades: [],
      extraRings: [],
      revision: 0,
      confirmedSignature: '',
      confirmedAt: '',
      abandonedPathNote: ''
    }
  }
  if (!Array.isArray(l.exportRecords)) l.exportRecords = []
  if (!l.selection.mode) l.selection.mode = 'uniform'
  return l.selection
}

/**
 * 按当前几何把选型状态补齐到正确长度（层数变化后新增层填推荐档）。
 * 只允许在事件边界（新建/载入/改层数/改判定方式）调用，不许在 computeSelection 里改状态。
 */
export function syncSelectionState(l: Lantern): StripSelection {
  const sel = ensureSelectionState(l)
  if (l.kind === 'polyhedron') return sel
  const g = buildGeometry(l)
  const inp = loadInputs(l, g)
  const per = modeConfig(l, g, 'perlayer', inp)
  const uni = modeConfig(l, g, 'uniform', inp)
  const fill = sel.mode === 'uniform' ? uni : per
  const nodeCount = l.layers.length + 1
  while (sel.ringGrades.length < nodeCount) sel.ringGrades.push(fill.ringGrades[sel.ringGrades.length])
  if (sel.ringGrades.length > nodeCount) sel.ringGrades = sel.ringGrades.slice(0, nodeCount)
  while (sel.extraRings.length < l.layers.length) sel.extraRings.push(per.extraRings[sel.extraRings.length] ?? 0)
  if (sel.extraRings.length > l.layers.length) sel.extraRings = sel.extraRings.slice(0, l.layers.length)
  return sel
}

/** 新建灯样时落一份初始推荐选型（R0，未确认） */
export function initSelection(l: Lantern): StripSelection {
  const sel = ensureSelectionState(l)
  if (l.kind === 'polyhedron') {
    if (!sel.ribGrade) sel.ribGrade = recommendConfig(l, buildGeometry(l)).ribGrade
    return sel
  }
  syncSelectionState(l)
  if (!sel.ribGrade) {
    const g = buildGeometry(l)
    const cfg = modeConfig(l, g, sel.mode, loadInputs(l, g))
    sel.ribGrade = cfg.ribGrade
    sel.ringGrades = [...cfg.ringGrades]
    sel.extraRings = [...cfg.extraRings]
  }
  return sel
}

/** 手工改动选型即让确认结论失效（版次保留，确认时才 +1 并作废旧导出） */
export function invalidateSelection(l: Lantern) {
  const sel = ensureSelectionState(l)
  sel.confirmedSignature = ''
}

/**
 * 有效配置（纯函数，不改灯样状态）：灯样上有完整选择就按它；
 * 首次打开/数组不齐时按当前模式的推荐补齐（只在返回值里补）。
 */
export function effectiveConfig(l: Lantern): SelectionConfig {
  const g = buildGeometry(l)
  const inp = loadInputs(l, g)
  if (l.kind === 'polyhedron') {
    const rec = recommendConfig(l, g, inp)
    return { mode: l.selection?.mode || 'uniform', ribGrade: l.selection?.ribGrade || rec.ribGrade, ringGrades: [], extraRings: [] }
  }
  const sel = ensureSelectionState(l)
  const per = modeConfig(l, g, 'perlayer', inp)
  const uni = modeConfig(l, g, 'uniform', inp)
  const mode: SelectionConfig['mode'] = sel.mode || 'uniform'
  if (!sel.ribGrade || sel.ringGrades.length !== l.layers.length + 1 || sel.extraRings.length !== l.layers.length) {
    return mode === 'uniform' ? uni : per
  }
  return { mode, ribGrade: sel.ribGrade, ringGrades: [...sel.ringGrades], extraRings: [...sel.extraRings] }
}

/** 已导出单据当前是否还有效：版次一致且参数指纹一致（不修改任何状态） */
export function isExportActive(l: Lantern, e: ExportRecord, currentSignature: string): boolean {
  return !e.voided && e.revision === l.selection.revision && e.signature === currentSignature
}

/** 沿竖篾的全部绑扎点：各层圈节点 + 每层补加圈节点（补加点取轮廓半径） */
export function buildLashingPoints(l: Lantern, g: Geometry, extraRings: number[]): LashingPoint[] {
  const pts: LashingPoint[] = []
  pts.push({ y: g.sections[0].yMm, r: g.sections[0].radiusMm, node: 0, course: 0, band: -1 })
  let nodeSeq = 1
  for (let i = 0; i < l.layers.length; i++) {
    const a = g.sections[i]
    const b = g.sections[i + 1]
    const e = extraRings[i] || 0
    for (let k = 1; k <= e; k++) {
      const t = k / (e + 1)
      const y = a.yMm + (b.yMm - a.yMm) * t
      pts.push({ y, r: radiusAtY(g.profile, y), node: nodeSeq++, course: k, band: i })
    }
    pts.push({ y: b.yMm, r: b.radiusMm, node: nodeSeq++, course: 0, band: i })
  }
  return pts
}

/** 圈节点（去重的 y 位置）：与绑扎点一一对应，node 字段在 plan 里需要映射到层数节点 */
interface RingNode {
  /** 对应 g.sections 的节点（补加圈为 -1） */
  sectionIndex: number
  bandIndex: number
  course: number
  y: number
  r: number
}

function ringNodes(l: Lantern, g: Geometry, extraRings: number[]): RingNode[] {
  const out: RingNode[] = [{ sectionIndex: 0, bandIndex: -1, course: 0, y: g.sections[0].yMm, r: g.sections[0].radiusMm }]
  for (let i = 0; i < l.layers.length; i++) {
    const a = g.sections[i]
    const b = g.sections[i + 1]
    const e = extraRings[i] || 0
    for (let k = 1; k <= e; k++) {
      const t = k / (e + 1)
      const y = a.yMm + (b.yMm - a.yMm) * t
      out.push({ sectionIndex: -1, bandIndex: i, course: k, y, r: radiusAtY(g.profile, y) })
    }
    out.push({ sectionIndex: i + 1, bandIndex: i, course: 0, y: b.yMm, r: b.radiusMm })
  }
  return out
}

/**
 * 构件计划行。净长与余量与旧 frame.ts 完全同源：
 *  - 圆圈 raw = 2πR，多边形圈 raw = 2Rsin(π/n)，接头余量圆 1 处 / 多边形每根 1 处
 *  - 竖篾 raw = 绑扎点折线累计；两端各 +lash
 * 补加圈只是把同一公式用在轮廓中间半径上。
 */
export function buildPlan(l: Lantern, g: Geometry, extraRings: number[]): PlanRow[] {
  const lash = Math.max(0, l.lashAllowanceMm)
  const rows: PlanRow[] = []
  const L = l.layers.length

  if (l.kind === 'polyhedron') {
    const info = polyhedronInfo(g)
    const isTetra = info.kind === 'tetra'
    rows.push({
      key: 'edge',
      kind: 'vertical',
      label: isTetra ? '棱篾（正四面体）' : '棱篾（正八面体）',
      group: '棱篾',
      qty: isTetra ? 6 : 12,
      rawMm: r1(info.edgeMm),
      lengthMm: r1(info.edgeMm + 2 * lash),
      lashJoints: 2,
      bendAngleDeg: 60,
      nodeIndex: -1,
      bandIndex: -1,
      extraCourse: 0,
      selector: 'rib',
      note: `端头夹角 60°（正三角形面角，刻角弯折不按弯弧考核，两端各留 ${lash}mm 绑扎余量）`
    })
    return rows
  }

  const pts = buildLashingPoints(l, g, extraRings)
  const ribLen = pts.reduce((s, p, i) => (i === 0 ? 0 : s + Math.hypot(p.y - pts[i - 1].y, p.r - pts[i - 1].r)), 0)

  if (l.kind === 'prism' || l.kind === 'box') {
    const n = g.n
    rows.push({
      key: 'rib',
      kind: 'vertical',
      label: '竖篾',
      group: '竖篾',
      qty: n,
      rawMm: r1(ribLen),
      lengthMm: r1(ribLen + 2 * lash),
      lashJoints: 2,
      nodeIndex: -1,
      bandIndex: -1,
      extraCourse: 0,
      selector: 'rib',
      note: `沿轮廓折线长（${pts.length - 1} 个绑扎跨累计），两端各留 ${lash}mm`
    })
    const bendAngle = 180 - 360 / n
    for (const node of ringNodes(l, g, extraRings)) {
      const edge = polygonEdge(node.r, n)
      const isExtra = node.course > 0
      const secLabel = node.sectionIndex === 0 ? '底盘' : node.sectionIndex === L ? '收口' : `第 ${node.sectionIndex} 层`
      const kind: MemberKind = node.sectionIndex === 0 ? 'base_ring' : node.sectionIndex === L ? 'mouth_ring' : 'ring'
      rows.push({
        key: `ring-${node.sectionIndex}-${node.course}`,
        kind,
        label: isExtra ? `第 ${node.bandIndex + 1} 层补加横篾（第 ${node.course} 道）` : `${secLabel}横篾`,
        group: isExtra ? `横篾圈（第 ${node.bandIndex + 1} 层补加）` : `${secLabel}圈`,
        qty: n,
        rawMm: r1(edge),
        lengthMm: r1(edge + lash),
        lashJoints: 1,
        bendAngleDeg: r1(bendAngle),
        nodeIndex: node.sectionIndex,
        bandIndex: node.bandIndex,
        extraCourse: node.course,
        selector: `ring:${Math.max(0, node.sectionIndex === -1 ? node.bandIndex + 1 : node.sectionIndex)}`,
        note: `圈直径 ${r1(node.r * 2)}mm，合围 ${n} 根，折角 ${r1(bendAngle)}°（刻角），含 1 处接头余量`
      })
    }
    if (l.kind === 'box') {
      rows.push({
        key: 'axle',
        kind: 'spoke',
        label: '中轴（走马灯转轴）',
        group: '走马机构',
        qty: 1,
        rawMm: r1(g.heightMm),
        lengthMm: r1(g.heightMm + 2 * lash),
        lashJoints: 2,
        nodeIndex: -1,
        bandIndex: -1,
        extraCourse: 0,
        selector: 'rib',
        note: '贯穿灯体中轴，两端各留绑扎余量'
      })
      const topR = g.sections[g.sections.length - 1].radiusMm
      const botR = g.sections[0].radiusMm
      rows.push({
        key: 'spoke',
        kind: 'spoke',
        label: '上下辐条',
        group: '走马机构',
        qty: n * 2,
        rawMm: r1((botR + topR) / 2),
        lengthMm: r1((botR + topR) / 2 + lash),
        lashJoints: 1,
        nodeIndex: -1,
        bandIndex: -1,
        extraCourse: 0,
        selector: 'rib',
        note: `上 ${n} 根 + 下 ${n} 根，由中心到棱角支撑中轴`
      })
    }
  } else {
    // 旋转体
    rows.push({
      key: 'rib',
      kind: 'rib',
      label: '竖篾（母线篾）',
      group: '竖篾',
      qty: n0(g),
      rawMm: r1(ribLen),
      lengthMm: r1(ribLen + 2 * lash),
      lashJoints: 2,
      nodeIndex: -1,
      bandIndex: -1,
      extraCourse: 0,
      selector: 'rib',
      note: `按母线折线长（${pts.length - 1} 个绑扎跨累计），两端各留 ${lash}mm`
    })
    for (const node of ringNodes(l, g, extraRings)) {
      const circ = TAU * node.r
      const isExtra = node.course > 0
      const secLabel = node.sectionIndex === 0 ? '底盘' : node.sectionIndex === L ? '收口' : `第 ${node.sectionIndex} 层`
      const kind: MemberKind = node.sectionIndex === 0 ? 'base_ring' : node.sectionIndex === L ? 'mouth_ring' : 'ring'
      rows.push({
        key: `ring-${node.sectionIndex}-${node.course}`,
        kind,
        label: isExtra ? `第 ${node.bandIndex + 1} 层补加横篾圈（第 ${node.course} 道）` : `${secLabel}横篾圈`,
        group: isExtra ? `横篾圈（第 ${node.bandIndex + 1} 层补加）` : `${secLabel}圈`,
        qty: 1,
        rawMm: r1(circ),
        lengthMm: r1(circ + lash),
        lashJoints: 1,
        bendRadiusMm: r1(node.r),
        nodeIndex: node.sectionIndex,
        bandIndex: node.bandIndex,
        extraCourse: node.course,
        selector: `ring:${Math.max(0, node.sectionIndex === -1 ? node.bandIndex + 1 : node.sectionIndex)}`,
        note: `圈直径 ${r1(node.r * 2)}mm，弯弧半径 ${r1(node.r)}mm，圆形圈 1 处接头`
      })
    }
    if (l.mouthStyle !== 'flat') {
      const topR = g.sections[g.sections.length - 1].radiusMm
      const braceR = (topR + g.maxR) / 2
      rows.push({
        key: 'mouth-brace',
        kind: 'ring',
        label: '收口支撑篾',
        group: '收口圈',
        qty: 1,
        rawMm: r1(TAU * braceR),
        lengthMm: r1(TAU * braceR + lash),
        lashJoints: 1,
        bendRadiusMm: r1(braceR),
        nodeIndex: L,
        bandIndex: L - 1,
        extraCourse: 0,
        selector: `ring:${L}`,
        note: '撑起收口肩部曲线，截面随收口档，圆形圈 1 处接头'
      })
    }
  }
  return rows
}

function n0(g: Geometry): number {
  return g.n
}

function r1(v: number): number {
  return Math.round(v * 10) / 10
}

/* ------------------------------------------------------------------ */
/* 荷载账（蒙面/胶/扎线/LED/骨架自重，逐层加总 = 总重换算）              */
/* ------------------------------------------------------------------ */

interface LoadInputs {
  sideCutMm2: number[]
  capTopCutMm2: number
  capBottomCutMm2: number
  cutAreaMm2: number
  bandRawSlant: number[]
  ledCount: number
}

function loadInputs(l: Lantern, g: Geometry): LoadInputs {
  const panels = buildPanels(l)
  const sideCutMm2 = l.layers.map((_, i) =>
    panels.panels.filter((p) => p.layerIndex === i).reduce((s, p) => s + panelCutArea(p) * p.qty, 0)
  )
  // 正多面体的三角面片 layerIndex=-1：全归到第 0 层
  if (l.kind === 'polyhedron') {
    sideCutMm2[0] = panels.panels.reduce((s, p) => s + panelCutArea(p) * p.qty, 0)
  }
  const capTop = panels.panels.find((p) => p.label.includes('顶盖'))
  const capBot = panels.panels.find((p) => p.label.includes('底盖'))
  const bandRawSlant = l.kind === 'polyhedron' ? [] : segmentInfos(g).map((s) => s.slantMm)
  const volumeL = bodyVolume(g) / 1_000_000
  const ledCount = Math.max(CRAFT.led.min, Math.ceil(volumeL * CRAFT.led.perLiter))
  return {
    sideCutMm2,
    capTopCutMm2: capTop ? panelCutArea(capTop) * capTop.qty : 0,
    capBottomCutMm2: capBot ? panelCutArea(capBot) * capBot.qty : 0,
    cutAreaMm2: panels.cutAreaMm2,
    bandRawSlant,
    ledCount
  }
}

/* ------------------------------------------------------------------ */
/* 配置评估                                                             */
/* ------------------------------------------------------------------ */

interface EvalResult {
  config: SelectionConfig
  rows: GradedRow[]
  demands: MemberDemand[]
  failures: Failure[]
  ledger: SelectionResult['ledger']
  ringLoads: RingLoadRow[]
  gradeLengths: GradeLength[]
  frameMassG: number
  stockLengthMm: number
  rawLengthMm: number
  ledCount: number
  cutAreaMm2: number
}

function gradeOfConfig(cfg: SelectionConfig, selector: GradeSelector): BambooGrade {
  if (selector === 'rib') return gradeById(cfg.ribGrade)
  const j = Number(selector.slice(5))
  return gradeById(cfg.ringGrades[j] || cfg.ribGrade)
}

function gradeRows(plan: PlanRow[], cfg: SelectionConfig): GradedRow[] {
  return plan.map((p) => {
    const grade = gradeOfConfig(cfg, p.selector)
    const massEachG = p.lengthMm * bambooLinearGPerMm(grade)
    return { ...p, grade, massEachG, massTotalG: massEachG * p.qty }
  })
}

function evaluate(l: Lantern, g: Geometry, cfg: SelectionConfig, inputs?: LoadInputs): EvalResult {
  const inp = inputs || loadInputs(l, g)
  const plan = buildPlan(l, g, cfg.extraRings)
  const rows = gradeRows(plan, cfg)
  const cov = coveringSpec(l.covering)
  const n = g.n
  const L = l.layers.length
  const poly = l.kind === 'polyhedron'

  // ---- 材料重量（按含缝份裁切面积，与备料统计同一面积来源） ----
  const matRate = (cov.weightGPerM2 + cov.gluePerM2) / 1_000_000
  const sideMatG = inp.sideCutMm2.map((a) => a * matRate)
  const capTopG = inp.capTopCutMm2 * matRate
  const capBottomG = inp.capBottomCutMm2 * matRate
  const frameMassG = rows.reduce((s, r) => s + r.massTotalG, 0)
  const totalJoints = rows.reduce((s, r) => s + r.qty * r.lashJoints, 0)
  const threadG = totalJoints * CRAFT.lashPerJointM * BAMBOO.threadGPerM
  const ledG = inp.ledCount * BAMBOO.ledGramEach
  const sideAreaSum = Math.max(1e-9, inp.sideCutMm2.reduce((s, x) => s + x, 0))

  const demands: MemberDemand[] = []

  if (poly) {
    // 正多面体：棱篾均分外载，折角 60° 刻角不按弯弧考核
    const edge = rows[0]
    const span = edge.rawMm
    const sideAll = sideMatG.reduce((s, x) => s + x, 0)
    const extG = sideAll + threadG + ledG
    const w = ((extG / edge.qty) * BAMBOO.gForce) / Math.max(1, span)
    const demand = beamDemand(edge, span, w * span, w, 0, true)
    demands.push(demand)
    const totalG = extG + frameMassG
    const sideShare = inp.sideCutMm2.map((a) => a / Math.max(1e-9, sideAreaSum))
    const gl = {
      bands: l.layers.map((_, i) => ({
        bandIndex: i,
        heightMm: l.layers[i]?.heightMm || 0,
        coverGlueG: sideMatG[i] || 0,
        ledG: ledG * sideShare[i],
        threadG: i === 0 ? threadG : 0,
        ribSelfG: 0,
        subtotalG: (sideMatG[i] || 0) + ledG * sideShare[i] + (i === 0 ? threadG : 0)
      })),
      capTopG: 0,
      capBottomG: 0,
      threadG,
      ringSelfG: frameMassG,
      totalG,
      totalKg: totalG / 1000,
      totalN: totalG * BAMBOO.gForce
    }
    return finishEval(cfg, rows, demands, gl, [], frameMassG, inp.ledCount, inp.cutAreaMm2)
  }

  // ---- 骨架自重按位置分摊 ----
  const ribRows = rows.filter((r) => r.selector === 'rib' && (r.kind === 'vertical' || r.kind === 'rib'))
  const ribRow = ribRows[0]
  const pts = buildLashingPoints(l, g, cfg.extraRings)
  const segLens: number[] = []
  for (let i = 1; i < pts.length; i++) segLens.push(Math.hypot(pts[i].y - pts[i - 1].y, pts[i].r - pts[i - 1].r))
  const ribTotalLen = segLens.reduce((s, x) => s + x, 0)
  const ribMassOne = ribRow ? ribRow.massEachG : 0
  // 每层分到的竖篾自重（n 根）
  const ribMassBand = l.layers.map((_, i) => {
    const segs = pts.slice(1).map((p, k) => ({ p, len: segLens[k] })).filter((x) => x.p.band === i)
    const len = segs.reduce((s, x) => s + x.len, 0)
    return n * ribMassOne * (ribTotalLen > 0 ? len / ribTotalLen : 0)
  })

  // 圈节点（sectionIndex 0..L）上的自重与扎线；补加圈挂到最近的 section 节点
  const nodes = ringNodes(l, g, cfg.extraRings)
  const nodeSelfG = Array.from({ length: L + 1 }, () => 0)
  const nodeThreadG = Array.from({ length: L + 1 }, () => 0)
  const nodeCourse = Array.from({ length: L + 1 }, () => 0)
  for (const rn of nodes) {
    const j = rn.sectionIndex >= 0 ? rn.sectionIndex : Math.max(0, rn.bandIndex + 1)
    const rr = rows.find((r) => r.key === `ring-${rn.sectionIndex}-${rn.course}`)
    if (rr) nodeSelfG[j] += rr.massTotalG
    if (rn.course > 0) nodeCourse[j] = Math.max(nodeCourse[j], rn.course)
  }
  // 扎线按节点接头数分摊：圈接头到对应圈节点；竖篾两端对半给底盘/收口；机构件接头全给底盘
  const jointCount: number[] = Array.from({ length: L + 1 }, () => 0)
  const nodeOfRow = (r: GradedRow): number => {
    if (r.selector === 'rib') return -1
    const j = Number(r.selector.slice(5))
    return Math.max(0, Math.min(L, j))
  }
  for (const rr of rows) {
    const joints = rr.qty * rr.lashJoints
    if (rr.kind === 'vertical' || rr.kind === 'rib') {
      jointCount[0] += joints / 2
      jointCount[L] += joints / 2
    } else if (rr.kind === 'spoke') {
      jointCount[0] += joints
    } else {
      jointCount[nodeOfRow(rr)] += joints
    }
  }
  const jointSum = jointCount.reduce((s, x) => s + x, 0)
  for (let j = 0; j <= L; j++) nodeThreadG[j] = threadG * (jointSum > 0 ? jointCount[j] / jointSum : 0)

  // ---- 每层重量账（加总必须 = 总重换算） ----
  const ledShareG = l.layers.map((_, i) => ledG * (inp.sideCutMm2[i] / sideAreaSum))
  // 扎线按节点分到相邻两层（端节点全给端层），保证逐层合计含全部扎线
  const threadBandG = Array.from({ length: L }, () => 0)
  for (let j = 0; j <= L; j++) {
    if (j === 0) threadBandG[0] += nodeThreadG[0]
    else if (j === L) threadBandG[L - 1] += nodeThreadG[L]
    else {
      threadBandG[j - 1] += nodeThreadG[j] / 2
      threadBandG[j] += nodeThreadG[j] / 2
    }
  }
  const bands: LedgerBand[] = l.layers.map((_, i) => ({
    bandIndex: i,
    heightMm: l.layers[i].heightMm,
    coverGlueG: sideMatG[i],
    ledG: ledShareG[i],
    threadG: threadBandG[i],
    ribSelfG: ribMassBand[i],
    subtotalG: sideMatG[i] + ledShareG[i] + threadBandG[i] + ribMassBand[i]
  }))

  // ---- 圈节点荷载：相邻层各分摊一半给圈，端节点加端盖 ----
  const ringLoads: RingLoadRow[] = []
  const ringLoadG: number[] = Array.from({ length: L + 1 }, () => 0)
  for (let j = 0; j <= L; j++) {
    const below = j > 0 ? sideMatG[j - 1] + ledShareG[j - 1] : 0
    const above = j < L ? sideMatG[j] + ledShareG[j] : 0
    const coverShareG = (1 - BAMBOO.ribLoadShare) * 0.5 * (below + above)
    const capG = (j === 0 ? capBottomG : 0) + (j === L ? capTopG : 0)
    const total = coverShareG + capG + nodeThreadG[j] + nodeSelfG[j]
    ringLoadG[j] = total
    ringLoads.push({
      nodeIndex: j,
      label: j === 0 ? '底盘圈' : j === L ? '收口圈' : `第 ${j} 层圈`,
      radiusMm: r1(g.sections[j].radiusMm),
      extraCourse: nodeCourse[j],
      ringSelfG: nodeSelfG[j],
      threadG: nodeThreadG[j],
      coverShareG,
      capG,
      totalG: total,
      totalN: total * BAMBOO.gForce,
      spanMm: r1(polygonEdge(g.sections[j].radiusMm, n))
    })
  }

  // 逐层合计 + 顶/底盖 + 横篾圈自重 = 总重（扎线已全部摊进各层）。
  // 账面全部保留全精度，界面显示时再四舍五入到 0.1g，保证「逐层加总 = 总重换算」。
  const ringSelfTotal = nodeSelfG.reduce((s, x) => s + x, 0)
  const totalG = bands.reduce((s, b) => s + b.subtotalG, 0) + capTopG + capBottomG + ringSelfTotal
  const ledger: EvalResult['ledger'] = {
    bands,
    capTopG,
    capBottomG,
    threadG,
    ringSelfG: ringSelfTotal,
    totalG,
    totalKg: totalG / 1000,
    totalN: totalG * BAMBOO.gForce
  }

  // ---- 竖篾各绑扎跨考核 ----
  if (ribRow) {
    const ribGrade = gradeById(cfg.ribGrade)
    // 轴向：整灯由 n 根竖篾吊挂
    const tension = (totalG * BAMBOO.gForce) / n
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]
      const p1 = pts[i]
      const span = Math.hypot(p1.y - p0.y, p1.r - p0.r)
      const band = p1.band < 0 ? 0 : p1.band
      const slantBand = inp.bandRawSlant[band] || span
      const bandLoadG = BAMBOO.ribLoadShare * (sideMatG[band] + ledShareG[band])
      const wLoad = ((bandLoadG / n) * BAMBOO.gForce) / Math.max(1, slantBand)
      const w = wLoad + ribLinearN(ribGrade)
      // 弯折需求半径：相邻两段折线在该点的折角 θ，R ≈ 段均长 / θ（弦折线近似）
      let bendRNeed: number | undefined
      if (i > 0 && i < pts.length - 1) {
        const pa = pts[i - 1]
        const pb = pts[i]
        const pc = pts[i + 1]
        const l1 = Math.hypot(pb.y - pa.y, pb.r - pa.r)
        const l2 = Math.hypot(pc.y - pb.y, pc.r - pb.r)
        const dot = ((pb.y - pa.y) * (pc.y - pb.y) + (pb.r - pa.r) * (pc.r - pb.r)) / Math.max(1e-9, l1 * l2)
        const theta = Math.acos(Math.min(1, Math.max(-1, dot)))
        if (theta > 0.002) bendRNeed = (l1 + l2) / 2 / theta
      }
      demands.push(beamDemand({
        key: `rib-span-${i}`,
        label: `竖篾第 ${i} 跨（${p0.band >= 0 ? `第 ${p0.band + 1} 层` : '底端'}→${p1.band >= 0 ? `第 ${p1.band + 1} 层` : '收口'}）`,
        grade: ribGrade,
        selector: 'rib',
        bandIndex: band,
        nodeIndex: -1,
        rawMm: span
      } as GradedRow, span, w * span, w, tension, false, bendRNeed))
    }
  }

  // ---- 各圈考核（原圈、补加圈、收口支撑篾逐个） ----
  const ringRowList = rows.filter((r) => r.kind === 'ring' || r.kind === 'mouth_ring' || r.kind === 'base_ring')
  for (const row of ringRowList) {
    const j = nodeOfRow(row)
    // 用该行自己的圈半径（补加圈取轮廓中间半径）
    const radius = g.polygon ? polygonRFromEdge(g, row.rawMm) : (row.bendRadiusMm ?? g.sections[j].radiusMm)
    const span = g.polygon ? row.rawMm : polygonEdge(radius, n)
    const arc = g.polygon ? row.rawMm : TAU * radius
    let loadG: number
    if (row.key === 'mouth-brace') {
      const band = L - 1
      loadG = (1 - BAMBOO.ribLoadShare) * (sideMatG[band] + ledShareG[band]) * 0.25 + row.massTotalG
    } else if (row.extraCourse > 0) {
      const band = Math.max(0, row.bandIndex)
      const extrasInBand = cfg.extraRings[band] || 0
      const share = (1 - BAMBOO.ribLoadShare) * (sideMatG[band] + ledShareG[band])
      loadG = share / (extrasInBand + 1) + row.massTotalG
    } else {
      loadG = ringLoadG[j]
    }
    const w = (loadG * BAMBOO.gForce) / Math.max(1, arc)
    const bendRNeed = g.polygon ? undefined : radius
    demands.push(beamDemand({
      key: `ring-demand-${row.key}`,
      label: row.label,
      grade: row.grade,
      selector: `ring:${j}`,
      bandIndex: row.bandIndex,
      nodeIndex: j,
      rawMm: span
    } as GradedRow, span, w * span, w, 0, g.polygon, bendRNeed))
  }

  return finishEval(cfg, rows, demands, ledger, ringLoads, frameMassG, inp.ledCount, inp.cutAreaMm2)
}

function ribLinearN(grade: BambooGrade): number {
  return bambooLinearGPerMm(grade) * BAMBOO.gForce
}

/** 多边形圈由单棱边长反推外接半径 R = a / (2 sin(π/n)) */
function polygonRFromEdge(g: Geometry, edgeMm: number): number {
  return edgeMm / (2 * Math.sin(Math.PI / g.n))
}

/** 单跨简支梁（偏保守，连续跨实际更小）：M = wL²/8，δ = 5wL⁴/384EI */
function beamDemand(
  row: GradedRow | { key: string; label: string; grade: BambooGrade; selector: GradeSelector; bandIndex: number; nodeIndex: number; rawMm: number },
  spanMm: number,
  loadN: number,
  wN: number,
  tensionN: number,
  polygonFold: boolean,
  bendRNeedMm?: number
): MemberDemand {
  const grade = row.grade
  const Z = sectionModulus(grade)
  const I = sectionInertia(grade)
  const M = (wN * spanMm * spanMm) / 8
  const stress = (M * BAMBOO.loadSafety) / Z
  const sag = (5 * wN * spanMm ** 4) / (384 * BAMBOO.elasticModulusNmm2 * I)
  const sagLimit = spanMm / BAMBOO.sagDivisor
  const bendLimit = minBendRadius(grade)
  const area = grade.widthMm * grade.thicknessMm
  const tension = area > 0 ? tensionN / area : 0
  const ratios = {
    span: spanMm / grade.maxSpanMm,
    stress: stress / BAMBOO.allowableBendNmm2,
    sag: sagLimit > 0 ? sag / sagLimit : 0,
    bend: bendRNeedMm && !polygonFold ? bendLimit / bendRNeedMm : 0,
    tension: tension / 40
  }
  const reason: FailureReason = pickReason(ratios)
  const pass = reason === null
  return {
    key: row.key,
    label: row.label,
    member: row.selector === 'rib' ? (row.key === 'edge' ? 'edge' : 'rib') : 'ring',
    selector: row.selector,
    gradeId: grade.id,
    bandIndex: row.bandIndex,
    nodeIndex: row.nodeIndex,
    spanMm: r1(spanMm),
    loadN: r2n(loadN),
    stressNmm2: r3(stress),
    sagMm: r3(sag),
    sagLimitMm: r2(sagLimit),
    bendRNeedMm: bendRNeedMm && !polygonFold ? r1(bendRNeedMm) : undefined,
    bendRLimitMm: r1(bendLimit),
    tensionNmm2: r3(tension),
    ratios: { span: r3(ratios.span), stress: r3(ratios.stress), sag: r3(ratios.sag), bend: r3(ratios.bend), tension: r3(ratios.tension) },
    reason,
    pass
  }
}

function pickReason(r: MemberDemand['ratios']): Exclude<FailureReason, null> | null {
  const entries: [Exclude<FailureReason, null>, number][] = [
    ['span', r.span],
    ['weight', Math.max(r.stress, r.sag)],
    ['bend', r.bend],
    ['span', r.tension]
  ]
  entries.sort((a, b) => b[1] - a[1])
  return entries[0][1] > 1 ? entries[0][0] : null
}

function finishEval(
  cfg: SelectionConfig,
  rows: GradedRow[],
  demands: MemberDemand[],
  ledger: EvalResult['ledger'],
  ringLoads: RingLoadRow[],
  frameMassG: number,
  ledCount: number,
  cutAreaMm2: number
): EvalResult {
  const failures: Failure[] = []
  for (const d of demands) {
    if (d.pass || !d.reason) continue
    const reasonText = d.reason === 'span' ? '跨度太长' : d.reason === 'weight' ? '重量太大' : '弯得太急'
    const detail =
      d.reason === 'span'
        ? `净跨 ${d.spanMm.toFixed(1)}mm 超过 ${gradeById(d.gradeId).name}允许净跨 ${gradeById(d.gradeId).maxSpanMm}mm（富余倍数 ${d.ratios.span.toFixed(2)}）`
        : d.reason === 'weight'
          ? `应力 ${d.stressNmm2.toFixed(2)}/${BAMBOO.allowableBendNmm2}N/mm²、挠度 ${d.sagMm.toFixed(2)}/${d.sagLimitMm.toFixed(2)}mm（荷载 ${d.loadN.toFixed(2)}N）`
          : `弯弧需求半径 ${d.bendRNeedMm?.toFixed(1)}mm 小于该档最小弯弧半径 ${d.bendRLimitMm.toFixed(1)}mm（${gradeById(d.gradeId).thicknessMm.toFixed(1)}mm 厚 × ${BAMBOO.bendRadiusFactor}）`
    failures.push({ member: d, reason: d.reason, reasonText, detail })
  }
  const stock = rows.reduce((s, r) => s + r.lengthMm * r.qty, 0)
  const raw = rows.reduce((s, r) => s + r.rawMm * r.qty, 0)
  const gradeMap = new Map<string, GradeLength>()
  for (const r of rows) {
    const cur = gradeMap.get(r.grade.id) || { grade: r.grade, lengthMm: 0, massG: 0, qty: 0 }
    cur.lengthMm += r.lengthMm * r.qty
    cur.massG += r.massTotalG
    cur.qty += r.qty
    gradeMap.set(r.grade.id, cur)
  }
  return {
    config: cfg,
    rows,
    demands,
    failures,
    ledger,
    ringLoads,
    gradeLengths: BAMBOO.grades.map((gd) => gradeMap.get(gd.id) || { grade: gd, lengthMm: 0, massG: 0, qty: 0 }),
    frameMassG,
    stockLengthMm: stock,
    rawLengthMm: raw,
    ledCount,
    cutAreaMm2
  }
}

/* ------------------------------------------------------------------ */
/* 推荐配置：先按跨度/重量各选最小档，撑不住就逐层补圈，仍不行才升级      */
/* ------------------------------------------------------------------ */

interface GradeWindow {
  selector: GradeSelector
  gMin: number
  gMax: number
  bandForRelief: number
}

function gradeWindows(l: Lantern, g: Geometry, extras: number[], inp: LoadInputs): { wins: GradeWindow[]; base: EvalResult } {
  // 先用中间档跑一遍拿到与截面弱相关的荷载（自重占比很小，两轮收敛）
  let base = evaluate(l, g, seedConfig(l, extras, 'perlayer'), inp)
  base = evaluate(l, g, configFromWindows(l, extras, winsOf(base, l), 'perlayer'), inp)
  return { wins: winsOf(base, l), base }
}

function seedConfig(l: Lantern, extras: number[], mode: SelectionConfig['mode']): SelectionConfig {
  const nodeCount = l.layers.length + 1
  return { mode, ribGrade: 'G4', ringGrades: Array.from({ length: nodeCount }, () => 'G4'), extraRings: [...extras] }
}

function winsOf(ev: EvalResult, l: Lantern): GradeWindow[] {
  const L = l.layers.length
  const selectors: GradeSelector[] = ['rib', ...Array.from({ length: L + 1 }, (_, j) => `ring:${j}` as GradeSelector)]
  return selectors.map((sel) => {
    const ds = ev.demands.filter((d) => d.selector === sel)
    let gMin = 0
    let gMax = BAMBOO.grades.length - 1
    for (const d of ds) {
      // 跨度/应力/挠度要求的最小档
      for (let k = 0; k < BAMBOO.grades.length; k++) {
        const grade = BAMBOO.grades[k]
        const spanOk = d.spanMm <= grade.maxSpanMm
        const Z = sectionModulus(grade)
        const I = sectionInertia(grade)
        const wN = d.loadN / Math.max(1, d.spanMm)
        const M = (wN * d.spanMm ** 2) / 8
        const stress = (M * BAMBOO.loadSafety) / Z
        const sag = (5 * wN * d.spanMm ** 4) / (384 * BAMBOO.elasticModulusNmm2 * I)
        if (spanOk && stress <= BAMBOO.allowableBendNmm2 && sag <= d.spanMm / BAMBOO.sagDivisor) {
          gMin = Math.max(gMin, k)
          break
        }
        if (k === BAMBOO.grades.length - 1) gMin = BAMBOO.grades.length // 最粗还不够
      }
      // 弯弧限制的最大档（多边形折角不考核）
      if (d.bendRNeedMm !== undefined) {
        for (let k = BAMBOO.grades.length - 1; k >= 0; k--) {
          if (minBendRadius(BAMBOO.grades[k]) <= d.bendRNeedMm) {
            gMax = Math.min(gMax, k)
            break
          }
          if (k === 0) gMax = -1
        }
      }
    }
    let bandForRelief = 0
    if (sel !== 'rib') {
      const j = Number(sel.slice(5))
      bandForRelief = j >= L ? L - 1 : j
    } else {
      const worst = ev.demands.filter((d) => d.selector === 'rib').sort((a, b) => Math.max(b.ratios.span, b.ratios.sag, b.ratios.stress) - Math.max(a.ratios.span, a.ratios.sag, a.ratios.stress))[0]
      bandForRelief = worst ? worst.bandIndex : 0
    }
    return { selector: sel, gMin, gMax, bandForRelief }
  })
}

function configFromWindows(l: Lantern, extras: number[], wins: GradeWindow[], mode: SelectionConfig['mode']): SelectionConfig {
  const nodeCount = l.layers.length + 1
  const ribWin = wins.find((w) => w.selector === 'rib')!
  let ribGrade = BAMBOO.grades[Math.min(ribWin.gMin, BAMBOO.grades.length - 1)].id
  const ringGrades = Array.from({ length: nodeCount }, (_, j) => {
    const w = wins.find((x) => x.selector === `ring:${j}`)!
    return BAMBOO.grades[Math.min(Math.max(0, w.gMin), BAMBOO.grades.length - 1)].id
  })
  if (mode === 'uniform') {
    const all = [gradeIndex(ribGrade), ...ringGrades.map(gradeIndex)]
    const u = Math.max(...all)
    ribGrade = BAMBOO.grades[u].id
    for (let j = 0; j < nodeCount; j++) ringGrades[j] = ribGrade
  }
  return { mode, ribGrade, ringGrades, extraRings: [...extras] }
}

/** 正多面体推荐档：从细到粗逐档试棱篾考核，取第一道通过的档 */
function recommendPolyGrade(l: Lantern, g: Geometry, inp: LoadInputs): string {
  for (const grade of BAMBOO.grades) {
    const ev = evaluate(l, g, { mode: 'perlayer', ribGrade: grade.id, ringGrades: [], extraRings: [] }, inp)
    if (ev.failures.length === 0) return grade.id
  }
  return BAMBOO.grades[BAMBOO.grades.length - 1].id
}

export function recommendConfig(l: Lantern, g: Geometry, inp?: LoadInputs): SelectionConfig {
  const inputs = inp || loadInputs(l, g)
  if (l.kind === 'polyhedron') {
    return { mode: 'perlayer', ribGrade: recommendPolyGrade(l, g, inputs), ringGrades: [], extraRings: [] }
  }
  const extras = Array.from({ length: l.layers.length }, () => 0)
  let wins: GradeWindow[] = []
  for (let guard = 0; guard < l.layers.length * BAMBOO.maxExtraRingsPerBand + 1; guard++) {
    const r = gradeWindows(l, g, extras, inputs)
    wins = r.wins
    const bad = wins.filter((w) => w.gMin > w.gMax || w.gMin >= BAMBOO.grades.length)
    if (bad.length === 0) break
    // 选最严重拦因所在层补一道圈
    const ev = r.base
    const worstFailure = ev.failures[0]
    let band = 0
    if (worstFailure) {
      band = worstFailure.member.selector === 'rib' ? worstFailure.member.bandIndex : Math.max(0, Math.min(l.layers.length - 1, worstFailure.member.nodeIndex === l.layers.length ? l.layers.length - 1 : worstFailure.member.nodeIndex))
    } else {
      band = bad[0].bandForRelief
    }
    if (extras[band] >= BAMBOO.maxExtraRingsPerBand) {
      const other = bad.find((b) => extras[b.bandForRelief] < BAMBOO.maxExtraRingsPerBand)
      if (!other) break
      band = other.bandForRelief
    }
    extras[band]++
  }
  return configFromWindows(l, extras, wins, 'perlayer')
}

/** 某模式下的配置：perlayer 用推荐；uniform 取全灯最不利一档 */
function modeConfig(l: Lantern, g: Geometry, mode: SelectionConfig['mode'], inp?: LoadInputs): SelectionConfig {
  const per = recommendConfig(l, g, inp)
  if (mode === 'perlayer') return per
  const all = [gradeIndex(per.ribGrade), ...per.ringGrades.map(gradeIndex)]
  const u = Math.max(...all)
  const id = BAMBOO.grades[u].id
  return { mode: 'uniform', ribGrade: id, ringGrades: per.ringGrades.map(() => id), extraRings: [...per.extraRings] }
}

/* ------------------------------------------------------------------ */
/* 两路补救：换粗一档 / 多添一道圈，代价各算各的                         */
/* ------------------------------------------------------------------ */

function buildRemedies(l: Lantern, g: Geometry, cfg: SelectionConfig, ev: EvalResult, inp: LoadInputs): Remedy[] {
  const worst = [...ev.failures].sort((a, b) => ratioOf(b.member) - ratioOf(a.member))[0]
  if (!worst) return []
  const d = worst.member

  // 路径一：换粗一档
  const cfgA: SelectionConfig = JSON.parse(JSON.stringify(cfg))
  let gradeUp: BambooGrade | null = null
  let thickerFeasible = true
  if (d.selector === 'rib') {
    const k = gradeIndex(cfgA.ribGrade)
    if (k >= BAMBOO.grades.length - 1) {
      thickerFeasible = false
    } else {
      gradeUp = BAMBOO.grades[k + 1]
      cfgA.ribGrade = gradeUp.id
      if (cfgA.mode === 'uniform') cfgA.ringGrades = cfgA.ringGrades.map(() => gradeUp!.id)
    }
  } else {
    const j = d.nodeIndex
    const k = gradeIndex(cfgA.ringGrades[j])
    if (cfgA.mode === 'uniform') {
      if (k >= BAMBOO.grades.length - 1) thickerFeasible = false
      else {
        gradeUp = BAMBOO.grades[k + 1]
        cfgA.ribGrade = gradeUp.id
        cfgA.ringGrades = cfgA.ringGrades.map(() => gradeUp!.id)
      }
    } else if (k >= BAMBOO.grades.length - 1) {
      thickerFeasible = false
    } else {
      gradeUp = BAMBOO.grades[k + 1]
      cfgA.ringGrades[j] = gradeUp.id
    }
  }
  const evA = thickerFeasible ? evaluate(l, g, cfgA, inp) : null
  const massDeltaA = evA ? evA.frameMassG - ev.frameMassG : 0
  const mouthLimit = gradeUp ? minBendRadius(gradeUp) : 0
  const remedyA: Remedy = {
    id: 'thicker',
    title: '把篾换粗一档',
    feasible: thickerFeasible,
    residualPass: evA ? evA.failures.length === 0 : false,
    costMaterial: thickerFeasible
      ? `竹篾增重 ${r1g(massDeltaA).toFixed(1)}g/灯（${ev.frameMassG.toFixed(1)}→${evA!.frameMassG.toFixed(1)}g），备料总长不变 ${(ev.stockLengthMm / 1000).toFixed(3)}m；粗一档材料更贵`
      : '目录已到最粗 G7（8.0×3.5mm），再粗只能双拼或定制，本路径走不通',
    costCraft: thickerFeasible
      ? `上口最小弯弧半径从 ${d.bendRLimitMm.toFixed(1)}mm 提到 ${mouthLimit.toFixed(1)}mm，弯上口更费劲、更要加热慢弯；统一档还会让全灯都跟着变粗`
      : '—',
    config: cfgA
  }
  if (thickerFeasible && d.reason === 'bend') {
    remedyA.cannotFix = '本次拦因是「弯得太急」：换粗只会让最小弯弧半径更大，弯得更急，此路不通'
  }

  // 路径二：多添一道横篾圈
  const cfgB: SelectionConfig = JSON.parse(JSON.stringify(cfg))
  let band = d.selector === 'rib' ? d.bandIndex : d.nodeIndex >= l.layers.length ? l.layers.length - 1 : d.nodeIndex
  band = Math.max(0, Math.min(l.layers.length - 1, band))
  const canAdd = cfgB.extraRings[band] < BAMBOO.maxExtraRingsPerBand && l.kind !== 'polyhedron'
  if (canAdd) cfgB.extraRings[band]++
  const evB = canAdd ? evaluate(l, g, cfgB, inp) : null
  const addedRows = evB ? evB.rows.filter((r) => r.extraCourse > 0) : []
  const addedLen = addedRows.reduce((s, r) => s + r.lengthMm * r.qty, 0) - ev.rows.filter((r) => r.extraCourse > 0).reduce((s, r) => s + r.lengthMm * r.qty, 0)
  const addedJoints = addedRows.reduce((s, r) => s + r.qty * r.lashJoints, 0) - ev.rows.filter((r) => r.extraCourse > 0).reduce((s, r) => s + r.qty * r.lashJoints, 0)
  const massDeltaB = evB ? evB.frameMassG - ev.frameMassG : 0
  const remedyB: Remedy = {
    id: 'extraRing',
    title: `多添一道横篾圈（第 ${band + 1} 层）`,
    feasible: canAdd,
    residualPass: evB ? evB.failures.length === 0 : false,
    costMaterial: canAdd
      ? `多备圈篾 ${r1(addedLen).toFixed(1)}mm（${(addedLen / 1000).toFixed(3)}m）、扎线约 ${(addedJoints * CRAFT.lashPerJointM).toFixed(2)}m、骨架增重 ${r1g(massDeltaB).toFixed(1)}g`
      : l.kind === 'polyhedron'
        ? '多面体没有横篾圈可添，此路不通'
        : `第 ${band + 1} 层补圈已到上限 ${BAMBOO.maxExtraRingsPerBand} 道，此路走不通`,
    costCraft: canAdd
      ? `每道圈多 ${g.polygon ? g.n : 1} 个合围接头、竖篾上多 ${g.n} 个绑扎点；加工时要多对位一道圈`
      : '—',
    config: cfgB
  }
  if (canAdd && d.reason === 'bend' && evB && evB.failures.some((f) => f.member.selector === d.selector && f.reason === 'bend')) {
    remedyB.cannotFix = '拦因在固定口径的弯弧上，补圈不改变该圈半径或硬折角，此路压不住'
  }
  return [remedyA, remedyB]
}

function ratioOf(d: MemberDemand): number {
  return Math.max(d.ratios.span, d.ratios.stress, d.ratios.sag, d.ratios.bend)
}

/* ------------------------------------------------------------------ */
/* 主入口：给我灯样，还你四处同一份选型结论                              */
/* ------------------------------------------------------------------ */

/**
 * 选型核定主入口（纯函数：只读灯样、只算结论，绝不回写响应式状态，
 * 否则在 Vue computed 里调用会自我触发死循环）。状态变更只发生在
 * init/sync/confirm/applyMode/applyRemedy/setGrade/setExtraRing/recordExport 等事件边界。
 */
export function computeSelection(l: Lantern): SelectionResult {
  ensureSelectionState(l)
  const g = buildGeometry(l)
  const inp = loadInputs(l, g)
  const poly = l.kind === 'polyhedron'

  const polyRec = poly ? recommendConfig(l, g, inp) : null
  const perCfg = poly
    ? { mode: 'perlayer' as const, ribGrade: polyRec!.ribGrade, ringGrades: [] as string[], extraRings: [] as number[] }
    : modeConfig(l, g, 'perlayer', inp)
  const uniCfg = poly
    ? { mode: 'uniform' as const, ribGrade: polyRec!.ribGrade, ringGrades: [] as string[], extraRings: [] as number[] }
    : modeConfig(l, g, 'uniform', inp)

  const stateCfg = effectiveConfig(l)
  const ev = evaluate(l, g, stateCfg, inp)
  const evPer = evaluate(l, g, perCfg, inp)
  const evUni = evaluate(l, g, uniCfg, inp)
  const remedies = ev.failures.length ? buildRemedies(l, g, stateCfg, ev, inp) : []

  const currentSignature = paramSignature(l)
  const sel = l.selection
  const stale = sel.revision === 0 || currentSignature !== sel.confirmedSignature
  const baseline = sel.baseline || null
  const diff = baseline && stale ? diffSelection(l, ev, baseline) : null
  // 已导出单据的有效性按版次+指纹派生，不在此改状态
  const exports = (l.exportRecords || []).map((e) => ({ ...e, voided: !isExportActive(l, e, currentSignature) }))

  const makeMode = (mode: 'uniform' | 'perlayer', e: EvalResult): ModeSummary => ({
    mode,
    config: e.config,
    pass: e.failures.length === 0,
    frameMm: r1(e.stockLengthMm),
    frameMassG: r1g(e.frameMassG),
    distinctGrades: new Set([...e.config.ringGrades, e.config.ribGrade]).size,
    ringCourses: e.rows.filter((r) => r.kind === 'ring' || r.kind === 'mouth_ring' || r.kind === 'base_ring').length,
    failures: e.failures
  })

  return {
    l,
    geometry: g,
    config: ev.config,
    recommended: perCfg,
    plan: buildPlan(l, g, ev.config.extraRings),
    rows: ev.rows,
    demands: ev.demands,
    failures: ev.failures,
    pass: ev.failures.length === 0,
    remedies,
    ledger: ev.ledger,
    ringLoads: ev.ringLoads,
    gradeLengths: ev.gradeLengths,
    frameMassG: ev.frameMassG,
    stockLengthMm: ev.stockLengthMm,
    rawLengthMm: ev.rawLengthMm,
    lashPoints: poly ? [] : buildLashingPoints(l, g, ev.config.extraRings),
    modes: { uniform: makeMode('uniform', evUni), perlayer: makeMode('perlayer', evPer) },
    stale,
    currentSignature,
    baseline,
    diff,
    abandonedPathNote: sel.abandonedPathNote || '',
    exports,
    polyMode: poly
  }
}

/** 节点（含补加圈）绘制/用料清单：预览画圈用 */
export function resultRingNodes(res: SelectionResult): { y: number; r: number; grade: BambooGrade; extraCourse: number; band: number }[] {
  if (res.polyMode) return []
  const nodes = ringNodes(res.l, res.geometry, res.config.extraRings)
  return nodes.map((rn) => {
    const j = rn.sectionIndex >= 0 ? rn.sectionIndex : Math.max(0, rn.bandIndex + 1)
    const row = res.rows.find((r) => r.key === `ring-${rn.sectionIndex}-${rn.course}`)
    return { y: rn.y, r: rn.r, grade: row?.grade || gradeById(res.config.ringGrades[j]), extraCourse: rn.course, band: rn.bandIndex }
  })
}

/** 蒙面裁切总面积 m²（与材料统计同一份 panels 数据） */
export function cutAreaMm2Of(l: Lantern): number {
  return Math.round((buildPanels(l).cutAreaMm2 / 1_000_000) * 1000) / 1000
}

/* ------------------------------------------------------------------ */
/* 确认 / 模式切换 / 导出登记 / 变更对照                                */
/* ------------------------------------------------------------------ */

export function buildSnapshot(l: Lantern, res: SelectionResult): SelectionSnapshot {
  const c9 = res.pass
  return {
    revision: l.selection.revision,
    signature: res.currentSignature,
    confirmedAt: new Date().toISOString(),
    mode: res.config.mode,
    ribGrade: res.config.ribGrade,
    ringGrades: [...res.config.ringGrades],
    extraRings: [...res.config.extraRings],
    frameMm: r1(res.stockLengthMm),
    frameRawMm: r1(res.rawLengthMm),
    frameMassG: r1g(res.frameMassG),
    covering: l.covering,
    coveringM2: cutAreaMm2Of(l),
    members: res.rows.map((r) => ({
      label: r.label,
      gradeId: r.grade.id,
      widthMm: r1(r.grade.widthMm),
      thicknessMm: r1(r.grade.thicknessMm),
      extraCourse: r.extraCourse,
      lengthTotalMm: r1(r.lengthMm * r.qty)
    })),
    gradeLengths: Object.fromEntries(res.gradeLengths.map((g2) => [g2.grade.id, r1(g2.lengthMm)])),
    layerRings: l.layers.map((_, i) => ({
      band: i,
      bottomNodeGrade: res.config.ringGrades[i] || res.config.ribGrade,
      topNodeGrade: res.config.ringGrades[i + 1] || res.config.ribGrade,
      extras: res.config.extraRings[i] || 0
    })),
    checks: { c9, c10: true, c11: ledgerBalanced(res) }
  }
}

/** CHK-11：逐层受力加起来 = 按总重换算（非多面体：层小计 + 顶底盖 + 圈自重；多面体：层小计 + 棱篾自重） */
export function ledgerBalanced(res: SelectionResult): boolean {
  const lg = res.ledger
  if (res.polyMode) {
    const sum = lg.bands.reduce((s, b) => s + b.subtotalG, 0)
    return Math.abs(sum + lg.ringSelfG - lg.totalG) < 1e-6
  }
  const sum = lg.bands.reduce((s, b) => s + b.subtotalG, 0) + lg.capTopG + lg.capBottomG + lg.ringSelfG
  return Math.abs(sum - lg.totalG) < 1e-6
}

/**
 * 确认当前选型：旧版结论与已导出备料单一并作废，版次 +1。
 * 撑不住时当场拦住，不允许确认（不允许把不通过的选型落成版次）。
 */
export function confirmSelection(l: Lantern, res?: SelectionResult): { ok: boolean; error?: string; result: SelectionResult } {
  const r = res || computeSelection(l)
  if (!r.pass) {
    const f = r.failures[0]
    return {
      ok: false,
      error: `当前规格撑不住（${f ? f.reasonText : '未通过'}），不能确认：请按给出的两条路选定一档后再过核定。`,
      result: r
    }
  }
  const sel = ensureSelectionState(l)
  const prevRevision = sel.revision
  sel.revision = prevRevision + 1
  sel.confirmedSignature = r.currentSignature
  sel.confirmedAt = new Date().toISOString()
  sel.abandonedPathNote = ''
  const snap = buildSnapshot(l, r)
  snap.revision = sel.revision
  sel.baseline = snap
  // 旧导出全部作废（事件边界，允许写状态）
  for (const e of l.exportRecords) e.voided = true
  return { ok: true, result: computeSelection(l) }
}

/** 切换判定方式：放弃的那条路写明在材料与加工上让出的代价 */
export function applyMode(l: Lantern, mode: SelectionConfig['mode']): void {
  const sel = ensureSelectionState(l)
  if (sel.mode === mode) return
  const res = computeSelection(l)
  const leaving = res.modes[sel.mode]
  const entering = res.modes[mode]
  const target = mode === 'uniform' ? res.modes.uniform.config : res.modes.perlayer.config
  const lenDelta = entering.frameMm - leaving.frameMm
  const massDelta = entering.frameMassG - leaving.frameMassG
  const parts: string[] = []
  parts.push(
    `放弃「${leaving.mode === 'uniform' ? '全灯统一档' : '逐层各选档'}」改走「${entering.mode === 'uniform' ? '全灯统一档' : '逐层各选档'}」：备料总长 ${(leaving.frameMm / 1000).toFixed(3)}m→${(entering.frameMm / 1000).toFixed(3)}m（${lenDelta >= 0 ? '+' : ''}${r1(lenDelta).toFixed(1)}mm），骨架自重 ${leaving.frameMassG.toFixed(1)}→${entering.frameMassG.toFixed(1)}g（${massDelta >= 0 ? '+' : ''}${r1g(massDelta).toFixed(1)}g），规格档 ${leaving.distinctGrades} 种→${entering.distinctGrades} 种。`
  )
  if (mode === 'uniform') {
    parts.push('让出的代价：上层被迫用粗档，上口更重、弯上口更难更要加热；换来的是备料只认一种规格、加工不用分层。')
  } else {
    parts.push('让出的代价：备料要分清多种规格、加工时一层层对档；换来的是上层细篾更轻、上口好弯、省料省重。')
  }
  sel.abandonedPathNote = parts.join('')
  sel.mode = mode
  sel.ribGrade = target.ribGrade
  sel.ringGrades = [...target.ringGrades]
  sel.extraRings = [...target.extraRings]
  invalidateSelection(l)
}

/** 应用补救路径（换粗/补圈），不自动确认，仍要重新过核定 */
export function applyRemedy(l: Lantern, r: Remedy): void {
  const sel = ensureSelectionState(l)
  sel.mode = r.config.mode
  sel.ribGrade = r.config.ribGrade
  sel.ringGrades = [...r.config.ringGrades]
  sel.extraRings = [...r.config.extraRings]
  invalidateSelection(l)
}

/** 手工指定某档（竖篾或某节点圈） */
export function setGrade(l: Lantern, selector: GradeSelector, gradeId: string): void {
  const sel = ensureSelectionState(l)
  if (selector === 'rib') {
    sel.ribGrade = gradeId
    if (sel.mode === 'uniform') sel.ringGrades = sel.ringGrades.map(() => gradeId)
  } else {
    const j = Number(selector.slice(5))
    sel.ringGrades[j] = gradeId
    if (sel.mode === 'uniform') {
      sel.ribGrade = gradeId
      sel.ringGrades = sel.ringGrades.map(() => gradeId)
    }
  }
  invalidateSelection(l)
}

export function setExtraRing(l: Lantern, band: number, courses: number): void {
  const sel = ensureSelectionState(l)
  sel.extraRings[band] = Math.max(0, Math.min(BAMBOO.maxExtraRingsPerBand, Math.round(courses)))
  invalidateSelection(l)
}

export function recordExport(l: Lantern, kind: ExportRecord['kind'], filename: string): { ok: boolean; error?: string; record?: ExportRecord } {
  const res = computeSelection(l)
  if (!res.pass) return { ok: false, error: '选型核定未通过（撑不住），备料单不能导出：先在骨架件表按提示选定规格并确认。' }
  if (res.stale) return { ok: false, error: '灯样参数已改动、选型结论尚未重算确认，旧版备料单已失效：请先确认新版选型再导出。' }
  const record: ExportRecord = {
    kind,
    filename,
    at: new Date().toISOString(),
    revision: l.selection.revision,
    signature: res.currentSignature,
    voided: false
  }
  l.exportRecords.unshift(record)
  return { ok: true, record }
}

/* ------------------------------------------------------------------ */
/* 变更对照：改了直径/蒙面后，四处各变了什么                              */
/* ------------------------------------------------------------------ */

function paramChangeLabels(l: Lantern, snap: SelectionSnapshot): string[] {
  // 指纹只给有无，这里给可读字段（与基线确认时的灯样粗比）
  const out: string[] = []
  out.push(`关键参数指纹 ${snap.signature.slice(0, 16)}… → ${paramSignature(l).slice(0, 16)}…（最大直径/总高/收口/分层高度/蒙面等）`)
  if (snap.covering !== l.covering) out.push(`蒙面材料 ${snap.covering} → ${l.covering}`)
  return out
}

export function diffSelection(l: Lantern, ev: EvalResult, snap: SelectionSnapshot): SelectionDiff {
  const memberChanges: string[] = []
  const oldMap = new Map(snap.members.map((m) => [`${m.label}#${m.extraCourse}`, m]))
  for (const r of ev.rows) {
    const key = `${r.label}#${r.extraCourse}`
    const old = oldMap.get(key)
    if (!old) {
      memberChanges.push(`新增「${r.label}」：${r.grade.name} ${r.grade.widthMm.toFixed(1)}×${r.grade.thicknessMm.toFixed(1)}mm，合计 ${(r.lengthMm * r.qty).toFixed(1)}mm`)
      continue
    }
    if (old.gradeId !== r.grade.id) {
      memberChanges.push(`「${r.label}」宽厚 ${old.widthMm.toFixed(1)}×${old.thicknessMm.toFixed(1)}mm（${old.gradeId}）→ ${r.grade.widthMm.toFixed(1)}×${r.grade.thicknessMm.toFixed(1)}mm（${r.grade.id}）`)
    }
  }
  for (const m of snap.members) {
    const key = `${m.label}#${m.extraCourse}`
    if (!ev.rows.some((r) => `${r.label}#${r.extraCourse}` === key)) memberChanges.push(`取消「${m.label}」（第 ${m.extraCourse} 道补加圈移除）`)
  }
  if (memberChanges.length === 0) memberChanges.push('各篾宽厚与道数未变')

  const materialChanges: string[] = []
  for (const gl of ev.gradeLengths) {
    const old = snap.gradeLengths[gl.grade.id] || 0
    if (Math.abs(old - gl.lengthMm) > 0.5) {
      materialChanges.push(`${gl.grade.name}（${gl.grade.widthMm.toFixed(1)}×${gl.grade.thicknessMm.toFixed(1)}mm）：${(old / 1000).toFixed(3)}m → ${(gl.lengthMm / 1000).toFixed(3)}m（${gl.lengthMm - old >= 0 ? '+' : ''}${r1(gl.lengthMm - old).toFixed(1)}mm），重 ${gl.massG.toFixed(1)}g`)
    }
  }
  materialChanges.push(`备料总长 ${(snap.frameMm / 1000).toFixed(3)}m → ${(ev.stockLengthMm / 1000).toFixed(3)}m；骨架自重 ${snap.frameMassG.toFixed(1)} → ${ev.frameMassG.toFixed(1)}g`)
  const coverM2 = ev.cutAreaMm2 / 1_000_000
  if (Math.abs(coverM2 - snap.coveringM2) > 0.0005) {
    materialChanges.push(`蒙面（含缝份）面积 ${snap.coveringM2.toFixed(3)} → ${coverM2.toFixed(3)} m²`)
  }
  if (snap.covering !== l.covering) materialChanges.push(`蒙面与胶全部按新材料重算：${snap.covering} → ${l.covering}`)

  const previewChanges: string[] = []
  if (l.kind === 'polyhedron') {
    previewChanges.push(`多面体无横篾圈；棱篾截面 ${snap.ribGrade} → ${ev.config.ribGrade}（${snap.ribGrade === ev.config.ribGrade ? '未变' : '已换'}）`)
  } else {
    l.layers.forEach((_, i) => {
      const old = snap.layerRings[i]
      if (!old) return
      const curBottom = ev.config.ringGrades[i]
      const curTop = ev.config.ringGrades[i + 1]
      const curExtra = ev.config.extraRings[i] || 0
      if (old.bottomNodeGrade !== curBottom || old.topNodeGrade !== curTop || old.extras !== curExtra) {
        previewChanges.push(`第 ${i + 1} 层圈：下 ${old.bottomNodeGrade}→${curBottom}、上 ${old.topNodeGrade}→${curTop}，补加圈 ${old.extras}→${curExtra} 道`)
      }
    })
    if (previewChanges.length === 0) previewChanges.push('各层圈截面与道数未变')
  }

  const c9 = ev.failures.length === 0
  const ledgerTotal = ev.ledger.bands.reduce((s, b) => s + b.subtotalG, 0) + ev.ledger.capTopG + ev.ledger.capBottomG + ev.ledger.ringSelfG
  const c11 = Math.abs(ledgerTotal - ev.ledger.totalG) < 1e-6
  const checkFlips: string[] = []
  if (snap.checks.c9 !== c9) checkFlips.push(`CHK-09 选型核定：${snap.checks.c9 ? '通过' : '不通过'} → ${c9 ? '通过' : '不通过'}`)
  if (snap.checks.c11 !== c11) checkFlips.push(`CHK-11 逐层受力合计：${snap.checks.c11 ? '通过' : '不通过'} → ${c11 ? '通过' : '不通过'}`)
  // diff 只在「基线有效 → 当前待确认」时生成，故版次结论必然翻成不通过
  checkFlips.push('CHK-12 选型版次：通过 → 不通过（当前结论待重新确认；旧版灯样与已导出备料单已作废）')

  return { paramChanges: paramChangeLabels(l, snap), memberChanges, materialChanges, previewChanges, checkFlips }
}

/* ------------------------------------------------------------------ */
/* 精度小工具                                                           */
/* ------------------------------------------------------------------ */

function r1g(v: number): number {
  return Math.round(v * 10) / 10
}
function r2(v: number): number {
  return Math.round(v * 100) / 100
}
function r2n(v: number): number {
  return r2(v)
}
function r3(v: number): number {
  return Math.round(v * 1000) / 1000
}
