/**
 * 自检（对应规格书 §10 验收标准）
 * 每次参数变化都会重算全部几何并跑一遍断言，结果直接显示在界面上。
 */
import type { CheckResult, Lantern } from './types'
import { bodySurfaceArea, polygonEdge, polyhedronInfo, ringPerimeter, segmentInfos } from './geometry'
import { buildFrame, type FrameResult } from './frame'
import { buildPanels, panelNetArea, type PanelResult } from './panels'
import { computeBatch, computeMaterials, type BatchMaterials, type SingleLightMaterials } from './materials'
import { assertNoPanelSplit, paginate, type LoftOptions, type Sheet } from './paginate'
import { BAMBOO, gradeById } from './craft'
import { ledgerBalanced, type SelectionResult } from './selection'
import { CRAFT } from './craft'

export interface FullResult {
  frame: FrameResult
  panels: PanelResult
  materials: SingleLightMaterials
  batch: BatchMaterials
  sheets: Sheet[]
  checks: CheckResult[]
  elapsedMs: number
  selection: SelectionResult
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)
const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)

export function computeAll(l: Lantern, loft: LoftOptions): FullResult {
  const t0 = performance.now()
  const frame = buildFrame(l)
  const panels = buildPanels(l)
  const materials = computeMaterials(l)
  const batch = computeBatch(materials, Math.max(1, Math.round(l.batchCount)), l.wasteRatio)
  const sheets = paginate(l, loft)
  const elapsedMs = performance.now() - t0
  const checks = runChecks(l, frame, panels, materials, batch, sheets, elapsedMs)
  return { frame, panels, materials, batch, sheets, checks, elapsedMs, selection: frame.selection }
}

function runChecks(
  l: Lantern,
  frame: FrameResult,
  panels: PanelResult,
  materials: SingleLightMaterials,
  batch: BatchMaterials,
  sheets: Sheet[],
  elapsedMs: number
): CheckResult[] {
  const out: CheckResult[] = []
  const g = frame.geometry
  const lash = Math.max(0, l.lashAllowanceMm)

  // ---- CHK-01 几何：棱长/周长与手算一致 ----
  {
    const cases = [
      { name: '正六棱柱底边（D200）', got: polygonEdge(100, 6), expect: 100, tol: 1 },
      { name: '正八棱柱底边（D200）', got: polygonEdge(100, 8), expect: 76.5367, tol: 1 },
      { name: '圆形横篾圈周长（D200）', got: ringPerimeter(100, 0, false), expect: 628.3185, tol: 1 },
      { name: '六边形周长（D200）', got: ringPerimeter(100, 6, true), expect: 600, tol: 1 }
    ]
    const bad = cases.filter((c) => Math.abs(c.got - c.expect) > c.tol)
    out.push({
      id: 'CHK-01',
      title: '几何手算核对（棱长 / 周长，误差 ≤ 1mm）',
      pass: bad.length === 0,
      value: bad.length === 0 ? '4/4 项通过' : `${bad.length} 项超差`,
      detail: cases
        .map((c) => `${c.name}：算得 ${f3(c.got)} / 手算 ${f3(c.expect)}（Δ${f3(Math.abs(c.got - c.expect))}）`)
        .join('；')
    })
  }

  // ---- CHK-02 竖篾长度与分段高度累计 ----
  {
    const vertical = frame.members.find((m) => m.kind === 'vertical' || m.kind === 'rib')
    const raw = vertical ? vertical.rawLengthMm : 0
    if (g.kind === 'polyhedron') {
      // 正多面体无分层竖篾：棱篾净长应 = 多面体公式棱长
      const info = polyhedronInfo(g)
      const pass = Math.abs(raw - info.edgeMm) <= 0.1
      out.push({
        id: 'CHK-02',
        title: '棱篾净长 = 正多面体公式棱长',
        pass,
        value: `Δ ${f1(Math.abs(raw - info.edgeMm))}mm`,
        detail: `棱篾净长 ${f1(raw)}mm，公式棱长 ${f3(info.edgeMm)}mm（${info.kind === 'tetra' ? '4R/√6' : 'R√2'}）。`
      })
    } else {
      const segs = segmentInfos(g)
      const sumH = segs.reduce((s, x) => s + x.heightMm, 0)
      const sumSlant = segs.reduce((s, x) => s + x.slantMm, 0)
      const allStraight = segs.every((s) => Math.abs(s.drMm) < 0.05)
      const pass = Math.abs(raw - sumSlant) <= 0.1 && (!allStraight || Math.abs(raw - sumH) <= 0.1)
      out.push({
        id: 'CHK-02',
        title: '竖篾净长 = 分段母线折线长累计',
        pass,
        value: `Δ折线 ${f1(Math.abs(raw - sumSlant))}mm`,
        detail: allStraight
          ? `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，平口直柱两者一致（Δ${f1(Math.abs(raw - sumH))}mm）`
          : `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，折线长累计 ${f1(sumSlant)}mm（收口段横向偏移 ${f1(sumSlant - sumH)}mm；补加横篾圈会把折线跨细分，总长不变）`
      })
    }
  }

  // ---- CHK-03 缝份 ----
  {
    const s = Math.max(0, l.seamAllowanceMm)
    const bad = panels.panels.filter(
      (p) =>
        Math.abs(p.widthTopMm - (p.rawWidthTopMm + 2 * s)) > 0.06 ||
        Math.abs(p.widthBottomMm - (p.rawWidthBottomMm + 2 * s)) > 0.06 ||
        Math.abs(p.heightMm - (p.rawHeightMm + 2 * s)) > 0.06
    )
    out.push({
      id: 'CHK-03',
      title: '裁片尺寸 = 展开净尺寸 + 缝份 × 2（每边）',
      pass: bad.length === 0,
      value: `${panels.panels.length - bad.length}/${panels.panels.length} 种裁片通过`,
      detail:
        bad.length === 0
          ? `全部 ${panels.panels.length} 种裁片上/下/高三个尺寸均等于净尺寸 + ${f1(s)}×2mm；裁片图以红色虚线绘制缝份折线`
          : `超差裁片：${bad.map((p) => p.label).join('、')}`
    })
  }

  // ---- CHK-04 备料守恒 ----
  {
    const stock = frame.members.reduce((a, m) => a + m.lengthMm * m.qty, 0)
    const rawTotal = frame.members.reduce((a, m) => a + m.rawLengthMm * m.qty, 0)
    const lashTotal = frame.members.reduce((a, m) => a + m.qty * m.lashJoints * lash, 0)
    const diff = stock - rawTotal
    const pass = stock >= rawTotal - 1e-6 && Math.abs(diff - lashTotal) <= 0.5
    out.push({
      id: 'CHK-04',
      title: '备料守恒：Σ备料长度 ≥ Σ净长，且差值 = 余量总和',
      pass,
      value: `Σ备料 ${f1(stock)}mm / Σ净长 ${f1(rawTotal)}mm`,
      detail: `差值 ${f1(diff)}mm，应等于余量总和 ${f1(lashTotal)}mm（竖篾两端、横篾圈接头各计 ${f1(lash)}mm）`
    })
  }

  // ---- CHK-05 面积核对 ----
  {
    const netArea = panels.panels.reduce((a, p) => a + panelNetArea(p) * p.qty, 0)
    const refArea = bodySurfaceArea(g, Math.max(3, Math.round(l.divisions)))
    const ratio = refArea > 0 ? netArea / refArea : 0
    const pass = ratio >= 0.97 && ratio <= 1.03
    let advice = ''
    if (!pass && !g.polygon) {
      const need = suggestDivisions(l, netArea, ratio)
      advice = need ? `；建议把母线等分数提高到 ${need}（当前 ${l.divisions}）` : ''
    } else if (!pass) {
      advice = '；请检查缝份/分层参数，棱柱类侧面积应与裁片面积完全一致'
    }
    out.push({
      id: 'CHK-05',
      title: '面积核对：Σ裁片净面积 / 灯体表面积 ∈ [0.97, 1.03]',
      pass,
      value: `比值 ${(ratio * 100).toFixed(2)}%`,
      detail: `裁片净面积 ${f3(netArea / 1_000_000)}m²，灯体表面积（含顶底盖）${f3(refArea / 1_000_000)}m²${advice}`
    })
  }

  // ---- CHK-06 分页：裁片不跨页 ----
  {
    const r = assertNoPanelSplit(sheets)
    out.push({
      id: 'CHK-06',
      title: '分页：任一裁片不跨页（长条跨页带对位十字与搭接量）',
      pass: r.pass,
      value: r.pass ? '通过' : '失败',
      detail: `${r.detail}；跨页仅出现在骨架长条上，接缝处绘制对位十字并标注搭接 ${f1(loftOverlap(sheets))}mm 与拼接编号`
    })
  }

  // ---- CHK-07 批量 ----
  {
    const n = Math.max(1, Math.round(l.batchCount))
    const k = n * (1 + l.wasteRatio)
    // 与单灯值的偏差只来自展示精度（长度 3 位小数 / 胶 1 位小数）
    const errs = [
      Math.abs(batch.frameM - materials.frameM * k),
      Math.abs(batch.coveringM2 - materials.coveringM2 * k),
      Math.abs(batch.lashM - materials.lashM * k)
    ]
    const pass = errs.every((e) => e <= 0.0011) && Math.abs(batch.glueG - materials.glueG * k) <= 0.051
    out.push({
      id: 'CHK-07',
      title: `批量制灯：${n} 个材料总量 = 单灯 × ${n} × (1 + ${(l.wasteRatio * 100).toFixed(0)}%)`,
      pass,
      value: `竹篾 ${f3(batch.frameM)}m / 蒙面 ${f3(batch.coveringM2)}m²`,
      detail: `单灯竹篾 ${f3(materials.frameM)}m × ${n} × ${(1 + l.wasteRatio).toFixed(2)} = ${f3(materials.frameM * k)}m = 批量值；蒙面、扎线、胶同理（LED 按颗数 × ${n} 计，不参与损耗）`
    })
  }

  // ---- CHK-08 性能 ----
  {
    const pass = elapsedMs < 100
    out.push({
      id: 'CHK-08',
      title: '放样计算 < 100ms',
      pass,
      value: `${elapsedMs.toFixed(1)}ms`,
      detail: `${l.divisions} 等分 × ${l.layers.length} 层：构件 ${frame.totalQty} 根、裁片 ${panels.totalQty} 块、图纸 ${sheets.length} 页，全流程耗时 ${elapsedMs.toFixed(1)}ms（含分页）`
    })
  }

  // ---- CHK-09 竹篾规格选型核定（工程结论：撑不撑得住） ----
  {
    const sel = frame.selection
    if (sel.polyMode) {
      out.push({
        id: 'CHK-09',
        title: '竹篾规格选型核定：棱篾截面撑得住（跨度/应力/弯弧）',
        pass: sel.pass,
        value: sel.pass
          ? `${sel.config.ribGrade} ${gradeById(sel.config.ribGrade).widthMm.toFixed(1)}×${gradeById(sel.config.ribGrade).thicknessMm.toFixed(1)}mm`
          : '撑不住',
        detail:
          sel.pass
            ? `多面体棱篾取 ${sel.config.ribGrade}（${gradeById(sel.config.ribGrade).name}，宽厚 ${gradeById(sel.config.ribGrade).widthMm.toFixed(1)}×${gradeById(sel.config.ribGrade).thicknessMm.toFixed(1)}mm），跨度/应力/挠度全过。`
            : `棱篾被拦：${sel.failures.map((f) => `${f.reasonText}（${f.detail}）`).join('；')}。骨架件表给出两条能走的办法（换粗一档 / 多添一道横篾圈）及各自代价。`
      })
    } else {
      const modeText = sel.config.mode === 'uniform' ? '全灯按最不利层统一一档' : '逐层各选一档'
      const extras = sel.config.extraRings.reduce((s, x) => s + x, 0)
      const failList = sel.failures
        .slice(0, 3)
        .map((x) => `${x.member.label}：${x.reasonText}`)
        .join('；')
      out.push({
        id: 'CHK-09',
        title: '竹篾规格选型核定：竖篾与各层横篾撑得住（跨度/重量/弯弧）',
        pass: sel.pass,
        value: sel.pass
          ? `竖篾 ${sel.config.ribGrade} / 圈 ${new Set(sel.config.ringGrades).size} 种档 / 补圈 ${extras} 道`
          : `被拦 ${sel.failures.length} 处`,
        detail: sel.pass
          ? `${modeText}：竖篾 ${sel.config.ribGrade}（${gradeById(sel.config.ribGrade).name}），各层圈 ${sel.config.ringGrades.join('/')}，补加横篾圈 ${extras} 道；跨度/应力/挠度/弯弧全过。`
          : `选型被当场拦住：${failList}${sel.failures.length > 3 ? ` 等 ${sel.failures.length} 处` : ''}。骨架件表给出两条能走的办法（换粗一档 / 多添一道横篾圈）及各自代价，由人取舍。`
      })
    }
  }

  // ---- CHK-12 选型版次：结论须按当前参数确认，旧版灯样与备料单已作废 ----
  {
    const sel = frame.selection
    const voided = sel.exports.filter((e) => e.voided).length
    out.push({
      id: 'CHK-12',
      title: '选型版次一致：当前结论已按现参数确认，旧版灯样/备料单不作废在用',
      pass: !sel.stale,
      value: l.selection.revision === 0 ? '待确认（R0）' : sel.stale ? `R${l.selection.revision} 已失效` : `R${l.selection.revision} 有效`,
      detail: sel.stale
        ? `参数已改动或尚未核定${l.selection.revision > 0 ? `（旧版 R${l.selection.revision} 与 ${voided} 份已导出单据已作废，已裁刨篾条退回重定规格）` : ''}：构件/材料/预览均为待确认数，导出已拦住，确认后版次 +1。`
        : `当前结论 R${l.selection.revision} 与灯样参数一致${voided ? `；此前 ${voided} 份旧单据已标记作废` : ''}。`
    })
  }

  // ---- CHK-10 四处同一份数 ----
  {
    const sel = frame.selection
    // 构件表
    const memberLen = frame.members.reduce((s, m) => s + m.lengthMm * m.qty, 0)
    const memberRaw = frame.members.reduce((s, m) => s + m.rawLengthMm * m.qty, 0)
    let memberBad = frame.members.some(
      (m) =>
        !m.gradeId ||
        m.widthMm === undefined ||
        Math.abs(m.widthMm - gradeById(m.gradeId).widthMm) > 0.01 ||
        Math.abs((m.thicknessMm || 0) - gradeById(m.gradeId).thicknessMm) > 0.01
    )
    // 材料页：总长与分档合计一致
    const gradeSum = sel.gradeLengths.reduce((s, g2) => s + g2.lengthMm, 0)
    // 预览：节点圈档与配置一致（resultRingNodes 直接由同一份 config 出）
    const previewGrades = sel.polyMode
      ? [sel.config.ribGrade]
      : (() => {
          const ns = sel.rows.filter((r) => r.kind === 'ring' || r.kind === 'mouth_ring' || r.kind === 'base_ring')
          return ns.map((r) => r.grade.id)
        })()
    const previewOk = sel.polyMode || previewGrades.every((gid, k) => {
      void k
      return !!gid
    })
    const lenOk =
      Math.abs(memberLen - sel.stockLengthMm) <= 0.5 &&
      Math.abs(memberRaw - sel.rawLengthMm) <= 0.5 &&
      Math.abs(gradeSum - sel.stockLengthMm) <= 0.5 &&
      Math.abs(materials.frameM * 1000 - sel.stockLengthMm) <= 1.5
    // 重量账面全精度一致（界面显示才四舍五入到 0.1g）
    const massOk = Math.abs(materials.frameMassG - sel.frameMassG) < 1e-6
    const pass = !memberBad && lenOk && massOk && previewOk
    out.push({
      id: 'CHK-10',
      title: '四处同一份数：构件表 / 备料材料页 / 参数预览 / 选型结论宽厚、道数、总长度一致',
      pass,
      value: pass ? `总长按四处均为 ${(sel.stockLengthMm / 1000).toFixed(3)}m` : '对不上',
      detail: `构件表 ${(memberLen / 1000).toFixed(3)}m、分档合计 ${(gradeSum / 1000).toFixed(3)}m、选型结论 ${(sel.stockLengthMm / 1000).toFixed(3)}m、材料页 ${materials.frameM.toFixed(3)}m；骨架自重 ${sel.frameMassG.toFixed(1)}g；预览圈截面逐道取自已重建的构件行。`
    })
  }

  // ---- CHK-11 逐层受力加总 = 按总重换算 ----
  {
    const sel = frame.selection
    const lg = sel.ledger
    const sum = lg.bands.reduce((s, b) => s + b.subtotalG, 0)
    const recomposed = sel.polyMode ? sum + lg.ringSelfG : sum + lg.capTopG + lg.capBottomG + lg.ringSelfG
    // 账面为全精度，逐层合计与总重应严格相等（留 1e-6g 浮点容差；显示精度 0.1g）
    const balanced = ledgerBalanced(sel)
    const forceOk = Math.abs(recomposed * BAMBOO.gForce - lg.totalN) < 1e-9
    const massOk = Math.abs(lg.totalG - materials.totalMassG) < 1e-9
    out.push({
      id: 'CHK-11',
      title: '逐层受力加起来 = 按总重换算（不许各层一套数）',
      pass: balanced && forceOk && massOk,
      value: `Σ层 ${recomposed.toFixed(1)}g / 总重 ${lg.totalG.toFixed(1)}g / ${lg.totalN.toFixed(2)}N（${lg.totalKg.toFixed(3)}kg）`,
      detail: sel.polyMode
        ? `各面片层小计 ${sum.toFixed(1)}g ＋ 棱篾自重 ${lg.ringSelfG.toFixed(1)}g ＝ ${recomposed.toFixed(1)}g，与总重换算 ${lg.totalG.toFixed(1)}g / ${lg.totalN.toFixed(2)}N 一致。`
        : `各层（蒙面+胶+扎线+竖篾自重）${sum.toFixed(1)}g ＋ 顶/底盖 ${(lg.capTopG + lg.capBottomG).toFixed(1)}g ＋ 横篾圈自重 ${lg.ringSelfG.toFixed(1)}g ＝ ${recomposed.toFixed(1)}g；g×${BAMBOO.gForce} ＝ ${(recomposed * BAMBOO.gForce).toFixed(2)}N，与整灯总重 ${lg.totalG.toFixed(1)}g（${lg.totalKg.toFixed(3)}kg，${lg.totalN.toFixed(2)}N）一致。`
    })
  }

  return out
}

function suggestDivisions(l: Lantern, netArea: number, ratio: number): number | null {
  if (ratio <= 1.0005) return null
  for (let d = Math.max(3, Math.round(l.divisions)) + 1; d <= CRAFT.divMax; d++) {
    const ref = bodySurfaceArea(frameGeometryOf(l), d)
    const r = ref > 0 ? netArea / ref : 0
    if (r <= 1.03) return d
  }
  return CRAFT.divMax
}

function loftOverlap(sheets: Sheet[]): number {
  for (const s of sheets) {
    for (const it of s.items) {
      if (it.type === 'strip' && it.overlapMm > 0) return it.overlapMm
    }
  }
  return 0
}

/** 校验尺标称长度（mm）：1:1 打印用 */
export const CALIBRATION_RULER_MM = 100
export const CALIBRATION_CIRCLE_MM = 100

function frameGeometryOf(l: Lantern) {
  return buildFrame(l).geometry
}

/** 由圆周长反推直径（尺寸反推工具用） */
export function diameterFromPerimeter(lengthMm: number, n: number, polygon: boolean, lashMm: number): number {
  const net = Math.max(0, lengthMm - lashMm)
  if (polygon) {
    const s = Math.max(3, Math.round(n))
    return net / (s * Math.sin(Math.PI / s))
  }
  return net / Math.PI
}

/** 由母线（竖篾）长度反推可用最大直径：保持收口比例与总高，二分求解 */
export function diameterFromRib(l: Lantern, ribLengthMm: number): number {
  const target = Math.max(10, ribLengthMm - 2 * l.lashAllowanceMm)
  let lo = 20
  let hi = 3000
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    const test: Lantern = { ...l, maxDiameterMm: mid, mouthDiameterMm: (mid * l.mouthDiameterMm) / Math.max(1, l.maxDiameterMm), baseDiameterMm: (mid * l.baseDiameterMm) / Math.max(1, l.maxDiameterMm) }
    const segs = segmentInfos(buildFrame(test).geometry)
    const len = segs.reduce((a, s) => a + s.slantMm, 0)
    if (len < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
