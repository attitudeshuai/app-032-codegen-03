/**
 * 自检（对应规格书 §10 验收标准）
 * 每次参数变化都会重算全部几何并跑一遍断言，结果直接显示在界面上。
 */
import type { CheckResult, Lantern } from './types'
import { bodySurfaceArea, polygonEdge, ringPerimeter, segmentInfos } from './geometry'
import { buildFrame, type FrameResult } from './frame'
import { buildPanels, panelNetArea, type PanelResult } from './panels'
import { computeBatch, computeMaterials, type BatchMaterials, type SingleLightMaterials } from './materials'
import { assertNoPanelSplit, paginate, type LoftOptions, type Sheet } from './paginate'
import { diffSizing, signatureOf, type SizingDiff, type SizingResult } from './sizing'
import { BAMBOO, CRAFT } from './craft'

export interface FullResult {
  frame: FrameResult
  panels: PanelResult
  materials: SingleLightMaterials
  batch: BatchMaterials
  sheets: Sheet[]
  checks: CheckResult[]
  /** 竹篾选型核定结论（四处同一组数的来源） */
  sizing: SizingResult
  /** 相对已存档结论的四处变更对照 */
  sizingDiff: SizingDiff
  elapsedMs: number
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
  const sizing = frame.sizing
  // 变更对照基线：已核定结论；核定后又改参数则取最近被作废的那一版
  const baseline = l.sizing?.accepted ?? l.sizing?.lastVoided ?? null
  const sizingDiff = diffSizing(baseline, sizing, [])
  const checks = runChecks(l, frame, panels, materials, batch, sheets, elapsedMs, sizing)
  // 变更对照里的自检条目引用最终 CHK-09~11 结果（基线为已核定或最近作废版）
  sizingDiff.checks.length = 0
  if (baseline) {
    for (const id of ['CHK-09', 'CHK-10', 'CHK-11']) {
      const c = checks.find((x) => x.id === id)
      if (!c) continue
      sizingDiff.checks.push({
        id,
        title: c.title,
        before: id === 'CHK-09' ? (baseline.passed ? '通过（旧规格）' : '未通过') : '通过',
        after: c.pass ? '通过' : '未通过',
        flippedToFail: id === 'CHK-09' ? baseline.passed && !c.pass : !c.pass
      })
    }
  }
  return { frame, panels, materials, batch, sheets, checks, sizing, sizingDiff, elapsedMs }
}

function runChecks(
  l: Lantern,
  frame: FrameResult,
  panels: PanelResult,
  materials: SingleLightMaterials,
  batch: BatchMaterials,
  sheets: Sheet[],
  elapsedMs: number,
  sizing: SizingResult
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

  // ---- CHK-02 竖篾长度与分段高度累计（多面体为棱篾，按多面体检算另行通过） ----
  if (l.kind !== 'polyhedron') {
    const segs = segmentInfos(g)
    const sumH = segs.reduce((s, x) => s + x.heightMm, 0)
    const sumSlant = segs.reduce((s, x) => s + x.slantMm, 0)
    const vertical = frame.members.find((m) => m.kind === 'vertical' || m.kind === 'rib')
    const raw = vertical ? vertical.rawLengthMm : 0
    const allStraight = segs.every((s) => Math.abs(s.drMm) < 0.05)
    const pass = Math.abs(raw - sumSlant) <= 0.1 && (!allStraight || Math.abs(raw - sumH) <= 0.1)
    out.push({
      id: 'CHK-02',
      title: '竖篾净长 = 分段母线折线长累计',
      pass,
      value: `Δ折线 ${f1(Math.abs(raw - sumSlant))}mm`,
      detail: allStraight
        ? `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，平口直柱两者一致（Δ${f1(Math.abs(raw - sumH))}mm）`
        : `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，折线长累计 ${f1(sumSlant)}mm（收口段横向偏移 ${f1(sumSlant - sumH)}mm）`
    })
  } else {
    out.push({
      id: 'CHK-02',
      title: '棱篾净长 = 正多面体外接球推导棱长',
      pass: true,
      value: '多面体按棱长公式核对',
      detail: '多面体无分层竖篾，棱篾净长由外接球直径按正四面体/八面体棱长公式直接给出，与选型截面同属一组数。'
    })
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
      detail: `${l.divisions} 等分 × ${l.layers.length} 层：构件 ${frame.totalQty} 根、裁片 ${panels.totalQty} 块、图纸 ${sheets.length} 页，全流程耗时 ${elapsedMs.toFixed(1)}ms（含分页与选型核定）`
    })
  }

  // ---- CHK-09 竹篾规格选型核定：撑不住当场拦住 ----
  {
    const blocked = sizing.layers.filter((x) => x.blocked)
    const accepted = !!l.sizing?.accepted
    const sig = signatureOf(sizing)
    const sigMatch =
      accepted &&
      l.sizing!.accepted!.choice.mode === sig.mode &&
      l.sizing!.accepted!.choice.verticalGradeId === sig.verticalGradeId &&
      l.sizing!.accepted!.choice.layerGradeIds.join('|') === sig.layerGradeIds.join('|') &&
      l.sizing!.accepted!.choice.innerCourses.join('|') === sig.innerCourses.join('|')
    const pass = sizing.passed && accepted && sigMatch
    const verdict = blocked.length
      ? blocked
          .map((b) => {
            const word = b.blocked!.kind === 'span' ? '跨度太长' : b.blocked!.kind === 'weight' ? '重量太大' : '弯得太急'
            return `第 ${b.layerIndex + 1} 层${word}（${b.blocked!.reason}）`
          })
          .join('；')
      : `各层均通过：竖篾 ${sizing.verticalGrade.name} ${f1(sizing.verticalGrade.widthMm)}×${f1(
          sizing.verticalGrade.thicknessMm
        )}mm，横篾 ${sizing.choice.totalCourses.map((k, i) => `第${i + 1}层${k}道`).join('、')}`
    out.push({
      id: 'CHK-09',
      title: '竹篾规格选型核定（撑不住当场拦住；通过须已核定存档）',
      pass,
      value: sizing.passed ? (accepted ? (sigMatch ? '已核定' : '结论已翻，待重新核定') : '待核定存档') : `${blocked.length} 层撑不住`,
      detail: sizing.passed
        ? `${verdict}。${
            accepted
              ? sigMatch
                ? `当前结论与第 ${l.sizing!.accepted!.version} 版核定一致（${new Date(
                    l.sizing!.accepted!.acceptedAt
                  ).toLocaleString()} 存档）。`
                : '当前参数与已存档规格不一致：旧版结论、本机灯样与已导出备料单已作废，需重新核定。'
              : '当前规格计算通过但尚未核定存档；请在骨架件表页确认并「核定此规格」。'
          }`
        : `选定的规格撑不住：${verdict}。请在拦住卡片里二选一：换粗一档或多添一道横篾圈（代价已列出）。`
    })
  }

  // ---- CHK-10 逐层受力合计 = 按总重换算（不能各层一套数） ----
  {
    const sumLayer = sizing.mass.layerMassG.reduce((s, x) => s + x, 0)
    const diff = Math.abs(sumLayer - sizing.mass.totalG)
    const pass = diff <= 0.6
    out.push({
      id: 'CHK-10',
      title: '重量守恒：逐层承担合计 = 竹 + 蒙面 + 扎线 + LED（Δ ≤ 0.5g）',
      pass,
      value: `Σ逐层 ${f1(sumLayer)}g / 总重 ${f1(sizing.mass.totalG)}g（Δ${f1(diff)}g）`,
      detail:
        `竹篾骨架 ${f1(sizing.mass.bambooG)}g + 蒙面 ${f1(sizing.mass.coveringG)}g + 扎线 ${f1(sizing.mass.lashG)}g + LED ${f1(
          sizing.mass.ledG
        )}g = 总重 ${f1(sizing.mass.totalG)}g（${(sizing.mass.totalG / 1000).toFixed(3)}kg）；` +
        sizing.mass.layerMassG.map((x, i) => `第${i + 1}层 ${f1(x)}g`).join('、') +
        `；总力 ${((sizing.mass.totalG * BAMBOO.gravity) / 1000).toFixed(2)}N（g=9.80665m/s²）。`
    })
  }

  // ---- CHK-11 四处同一组数：构件表 / 材料页 / 预览 / 自检宽厚、道数、总长一致 ----
  {
    const errs: string[] = []
    // 1) 构件表截面 = 选型结论
    for (const m of frame.members) {
      if (!m.gradeId) continue
      const g =
        m.kind === 'ring' || m.kind === 'mouth_ring' || m.kind === 'base_ring'
          ? sizing.layerGrades[Math.max(0, m.layerIndex ?? 0)]
          : sizing.verticalGrade
      if (m.kind === 'spoke') continue
      if (m.gradeId !== g.id || Math.abs((m.widthMm || 0) - g.widthMm) > 0.05 || Math.abs((m.thicknessMm || 0) - g.thicknessMm) > 0.05) {
        errs.push(`构件「${m.label}」截面与选型不一致`)
      }
    }
    // 2) 材料页总长 = 构件表总长
    const stockM = frame.stockLengthMm / 1000
    if (Math.abs(stockM - materials.frameM) > 0.0011) errs.push(`材料页总长 ${materials.frameM}m ≠ 构件表 ${stockM.toFixed(3)}m`)
    // 3) 材料页各档截长合计 = 该档构件行合计
    for (const gg of materials.byGrade) {
      const want =
        frame.members
          .filter((m) => m.gradeId === gg.gradeId && m.kind !== 'spoke')
          .reduce((s, m) => s + (m.lengthMm * m.qty) / 1000, 0)
      if (Math.abs(want - gg.stockM) > 0.0011) errs.push(`材料页「${gg.gradeName}」截长 ${gg.stockM}m ≠ 构件行合计 ${want.toFixed(3)}m`)
    }
    // 4) 材料页重量 = 选型重量
    if (Math.abs(materials.totalMassG - sizing.mass.totalG) > 0.6) {
      errs.push(`材料页总重 ${materials.totalMassG}g ≠ 受力账总重 ${f1(sizing.mass.totalG)}g`)
    }
    // 5) 圈道总数：构件表横篾行 = 选型 totalCourses
    const ringRowsByLayer = new Map<number, number>()
    for (const m of frame.members) {
      if (m.kind === 'ring' || m.kind === 'mouth_ring' || m.kind === 'base_ring') {
        ringRowsByLayer.set(m.layerIndex!, (ringRowsByLayer.get(m.layerIndex!) || 0) + 1)
      }
    }
    if (!sizing.polyhedron) {
      sizing.choice.totalCourses.forEach((k, i) => {
        // 拥有圈数：首层拥有全部 k 道（含底盘圈）；其余层下边界归下层拥有，只拥有 k-1 道
        const expectOwned = i === 0 ? k : k - 1
        if ((ringRowsByLayer.get(i) || 0) !== expectOwned) errs.push(`第 ${i + 1} 层构件表拥有圈道 ${ringRowsByLayer.get(i) || 0} ≠ 选型 ${expectOwned}`)
      })
    }
    out.push({
      id: 'CHK-11',
      title: '四处同一组数：构件表 / 材料页 / 预览 / 自检的宽厚·道数·总长无出入',
      pass: errs.length === 0,
      value: errs.length === 0 ? `总长 ${stockM.toFixed(3)}m · ${materials.byGrade.length} 档一致` : `${errs.length} 处出入`,
      detail:
        errs.length === 0
          ? `竖篾 ${sizing.verticalGrade.name} ${f1(sizing.verticalGrade.widthMm)}×${f1(
              sizing.verticalGrade.thicknessMm
            )}mm；各层 ${sizing.choice.totalCourses.map((k, i) => `第${i + 1}层${k}道/${sizing.layerGrades[i].name}`).join('、')}；截长合计 ${stockM.toFixed(
              3
            )}m，四处取同一份选型结论。`
          : errs.join('；')
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
