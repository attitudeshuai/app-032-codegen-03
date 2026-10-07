/**
 * 竹篾规格选型核定
 * 数据纪律：净长/跨度/弯折半径一律取自 layout（轮廓与棱长周长、骨架构件与绑扎余量），
 * 逐层高度与上口收分走同一份灯样参数，选型不重新量任何尺寸。
 *
 * 估算模型（手工可复算，单位与精度显式标注）：
 *  - 重量（g）：蒙面=含缝份裁片面积×克重；竹=Σ截取长度×截面面积×密度；扎线=绑扎处×0.5m/处×0.5g/m；LED=颗数×单颗含线
 *  - 横篾圈：相邻竖篾支点间按简支梁，M=qL²/8（N·mm），δ=5qL⁴/(384EI) ≤ L/120
 *  - 竖篾：按该层支撑间距（=该层母线折线长÷(内部圈+1)）为跨度，承受自身自重+分配下来的蒙面（工程假定 50% 走竖篾）
 *  - 弯形：t ≤ ε·R（冷弯许用应变）；竖篾在收口段还要能顺着肩部半径 R 弯
 * 截面：环竖载时 h=宽、b=厚（宽面朝上下）；环成型/竖篾侧弯时 h=厚。
 */
import type {
  CheckResult,
  FrameMember,
  Lantern,
  SizingChoiceSignature,
  SizingLedgerEntry,
  SizingMode,
  SizingSnapshot
} from './types'
import { BAMBOO, bambooGrade, BambooGrade, coveringSpec, CRAFT } from './craft'
import { bodyVolume, r1, r3 } from './geometry'
import { buildLayout, layoutMembers, type FrameLayout, type LayerCoursePlan, type RingPosition } from './layout'
import { buildPanels, panelCutArea } from './panels'

export type FailureKind = 'span' | 'weight' | 'bend'

export interface MemberCheck {
  demandGradeIndex: number
  strengthUtil: number
  deflectionUtil: number
  formingUtil: number
  fail?: FailureKind
  /** 失败明细（mm/g/N 等已带数值） */
  failDetail?: string
}

export interface RemedyOption {
  path: 'grade' | 'courses'
  /** 是否可行（弯得太急时换粗只会更弯，grade 路不可行） */
  viable: boolean
  title: string
  target: {
    mode: SizingMode
    uniformGradeId: string | null
    courseOverrides: (number | null)[]
    gradeOverrides?: (string | null)[]
  }
  /** 方案本身在材料与加工上的代价 */
  cost: string
  addedBambooG: number
  addedCourses: number
  wouldPass: boolean
}

export interface RingCheckView {
  yMm: number
  radiusMm: number
  spanMm: number
  lineLoadGPerMm: number
  bendMomentNmm: number
  demandSectionModulusMm3: number
  actualSectionModulusMm3: number
  strengthUtil: number
  deflectionMm: number
  deflectionLimitMm: number
  deflectionUtil: number
  formingR: number
  formingMaxThicknessMm: number
  formingUtil: number
}

export interface RibCheckView {
  spanMm: number
  lineLoadGPerMm: number
  bendMomentNmm: number
  strengthUtil: number
  deflectionMm: number
  deflectionLimitMm: number
  deflectionUtil: number
  /** 收口段成型半径（mm；平口直段为 null 表示不需弯） */
  formingR: number | null
  formingMaxThicknessMm: number | null
  formingUtil: number
}

export interface LayerBlock {
  kind: FailureKind
  reason: string
  remedies: RemedyOption[]
}

export interface LayerSizingEvaluation {
  layerIndex: number
  heightMm: number
  diameterMm: number
  /** 上口该层收进量（mm，轮廓两段半径差） */
  tuckMm: number
  ribSpanMm: number
  totalCourses: number
  ringGrade: BambooGrade
  ribGrade: BambooGrade
  /** 该层承担重量（g） */
  layerMassG: number
  ring: RingCheckView
  rib: RibCheckView
  check: MemberCheck
  blocked?: LayerBlock
}

export interface MassSummary {
  bambooG: number
  coveringG: number
  lashG: number
  ledG: number
  totalG: number
  totalKg: number
  /** 逐层承担重量（g，长度=层数；多面体只有 1 项） */
  layerMassG: number[]
}

export interface ModeNote {
  mode: SizingMode
  feasible: boolean
  detail: string
  conflictAt?: string
}

export interface SizingResult {
  l: Lantern
  layout: FrameLayout
  /** 实际生效的同一组数（四处共用） */
  choice: SizingChoiceSignature
  recommended: SizingChoiceSignature
  overridesNote: string
  grades: BambooGrade[]
  verticalGrade: BambooGrade
  layerGrades: BambooGrade[]
  members: FrameMember[]
  mass: MassSummary
  layers: LayerSizingEvaluation[]
  uniformNote: ModeNote
  byLayerNote: ModeNote
  passed: boolean
  worstLayer: number
  blockedCount: number
  /** 当前模式相对另一种判定方式让出的代价 */
  modeTradeoff: string
  polyhedron: boolean
}

/** 一次求解的人工输入（建议阶段全为 null/默认） */
interface SolveInput {
  mode: SizingMode
  uniformGradeId: string | null
  courseOverrides: (number | null)[]
  gradeOverrides: (string | null)[]
}

interface Intermediate {
  rings: { ring: RingPosition; gradeIndex: number; stockMm: number; selfG: number }[]
  coverLayerG: number[]
  /** 每道拥有圈分到的蒙面重（g），按全灯带分配，含上下层各半的共享边界 */
  coverRingG: Map<string, number>
  lashLayerG: number[]
  bambooLayerG: number[]
  ledLayerG: number[]
  layerG: number[]
  ribLinearGPerMm: number
  ribLashG: number
}

const GRADE_INDEX = new Map(BAMBOO.grades.map((g, i) => [g.id, i]))
const LAST_G = BAMBOO.grades.length - 1
const N_PER_G = BAMBOO.gravity / 1000 // 1g 重量 → N

function emptyChoice(layers: number, mode: SizingMode, gradeId = BAMBOO.grades[1].id): SizingChoiceSignature {
  return {
    mode,
    verticalGradeId: gradeId,
    layerGradeIds: Array.from({ length: layers }, () => gradeId),
    innerCourses: Array.from({ length: layers }, () => 0),
    totalCourses: Array.from({ length: layers }, () => 0)
  }
}

// ---------------------------------------------------------------------------
// 选型主入口
// ---------------------------------------------------------------------------

export function computeSizing(l: Lantern): SizingResult {
  const st = l.sizing
  const mode: SizingMode = st?.mode || 'uniform'

  if (l.kind === 'polyhedron') return computePolyhedron(l, mode)

  const currentInput: SolveInput = {
    mode,
    uniformGradeId: mode === 'uniform' ? st?.uniformGradeId ?? null : null,
    courseOverrides: st?.courseOverrides ?? Array.from({ length: l.layers.length }, () => null),
    gradeOverrides: mode === 'byLayer' ? st?.gradeOverrides ?? Array.from({ length: l.layers.length }, () => null) : Array.from({ length: l.layers.length }, () => null)
  }
  // 建议视角：两种模式各按最小够用跑一遍
  const suggestInput: SolveInput = {
    mode,
    uniformGradeId: null,
    courseOverrides: Array.from({ length: l.layers.length }, () => null),
    gradeOverrides: Array.from({ length: l.layers.length }, () => null)
  }
  const uniformSuggest = solveMode(l, { ...suggestInput, mode: 'uniform' })
  const byLayerSuggest = solveMode(l, { ...suggestInput, mode: 'byLayer' })
  const recommended = mode === 'uniform' ? uniformSuggest.choice : byLayerSuggest.choice

  const current = solveMode(l, currentInput)
  const overridesNote = describeOverrides(recommended, current.choice)

  let worst = 0
  let bu = -1
  current.layers.forEach((e, i) => {
    const u = Math.max(e.check.strengthUtil, e.check.deflectionUtil, e.check.formingUtil)
    if (u > bu) {
      bu = u
      worst = i
    }
  })

  const maxId = current.choice.layerGradeIds[
    current.choice.layerGradeIds.reduce((mi, id, i, arr) => (GRADE_INDEX.get(id)! > GRADE_INDEX.get(arr[mi])! ? i : mi), 0)
  ]
  const modeTradeoff =
    mode === 'uniform'
      ? `采用「全灯统一一档（${gradeName(current.choice.verticalGradeId)}）」：备料简单、加工省事；让出的代价是上层更重（全灯竹重 ${
          current.mass.bambooG.toFixed(1)
        }g；逐层方案约 ${byLayerSuggest.mass.bambooG.toFixed(1)}g，多 ${(current.mass.bambooG - byLayerSuggest.mass.bambooG).toFixed(1)}g）、上口更难弯（口部也得用 ${
          gradeName(maxId)
        }）。`
      : `采用「逐层各选一档」：省料省重（全灯竹重 ${current.mass.bambooG.toFixed(1)}g；统一方案约 ${
          uniformSuggest.mass.bambooG.toFixed(1)
        }g，省 ${(uniformSuggest.mass.bambooG - current.mass.bambooG).toFixed(1)}g）；让出的代价是规格变多（全灯共 ${
          new Set(current.choice.layerGradeIds.concat(current.choice.verticalGradeId)).size
        } 种截面）、加工时得一层层分清。`

  return {
    l,
    layout: current.layout,
    choice: current.choice,
    recommended,
    overridesNote,
    grades: BAMBOO.grades,
    verticalGrade: bambooGrade(current.choice.verticalGradeId),
    layerGrades: current.choice.layerGradeIds.map((id) => bambooGrade(id)),
    members: current.members,
    mass: current.mass,
    layers: current.layers,
    uniformNote: uniformSuggest.note,
    byLayerNote: byLayerSuggest.note,
    passed: current.passed,
    worstLayer: worst + 1,
    blockedCount: current.layers.filter((x) => x.blocked).length,
    modeTradeoff,
    polyhedron: false
  }
}

interface SolvedMode {
  choice: SizingChoiceSignature
  layout: FrameLayout
  members: FrameMember[]
  mass: MassSummary
  layers: LayerSizingEvaluation[]
  passed: boolean
  note: ModeNote
}

function solveMode(l: Lantern, input: SolveInput): SolvedMode {
  const { mode } = input
  const nLayers = l.layers.length

  const { ringGradeIdx, ribGradeIdx, innerCourses } = searchSelection(l, input)

  if (mode === 'uniform') {
    const uni = input.uniformGradeId
      ? GRADE_INDEX.get(input.uniformGradeId)!
      : Math.max(...ringGradeIdx, ribGradeIdx[0])
    for (let i = 0; i < nLayers; i++) ringGradeIdx[i] = uni
    ribGradeIdx[0] = Math.max(ribGradeIdx[0], uni)
  }

  const choice: SizingChoiceSignature = {
    mode,
    verticalGradeId: BAMBOO.grades[ribGradeIdx[0]].id,
    layerGradeIds: ringGradeIdx.map((i) => BAMBOO.grades[i].id),
    innerCourses,
    totalCourses: innerCourses.map((k) => k + 2)
  }

  const layout = buildLayout(l, innerCourses)
  const inter = computeIntermediate(l, layout, choice)
  const members = materializeMembers(l, layout, choice)
  const evals = buildEvaluations(l, layout, choice, inter, input)
  const passed = evals.every((e) => !e.blocked)

  const blocked = evals.filter((e) => e.blocked)
  const note: ModeNote =
    mode === 'uniform'
      ? {
          mode,
          feasible: passed,
          detail: passed
            ? `全灯按最不利的第 ${worstIndex(evals) + 1} 层统一选「${BAMBOO.grades[Math.max(...ringGradeIdx)].name}」，备料简单、加工省事。`
            : `统一档在以下层撑不住：${blocked.map((e) => `第${e.layerIndex + 1}层（${e.blocked!.reason.split('；')[0]}）`).join('、')}。`,
          conflictAt: blocked.find((e) => e.blocked?.kind === 'bend')
            ? `第 ${blocked.find((e) => e.blocked?.kind === 'bend')!.layerIndex + 1} 层上口`
            : undefined
        }
      : {
          mode,
          feasible: passed,
          detail: passed
            ? `逐层各选一档（${ringGradeIdx.map((gi, i) => `${i + 1}层${BAMBOO.grades[gi].name}`).join('、')}），省料省重，加工需分层分清。`
            : `即使逐层选档仍有层撑不住：${blocked
                .map((e) => `第${e.layerIndex + 1}层（${e.blocked!.reason.split('；')[0]}）`)
                .join('、')}；需改灯样参数（减小跨度/换轻蒙面/减小上口收分）。`
        }

  return { choice, layout, members, mass: massOf(members, inter), layers: evals, passed, note }
}

function worstIndex(evals: LayerSizingEvaluation[]): number {
  let bi = 0
  let bu = -1
  evals.forEach((e, i) => {
    const u = Math.max(e.check.strengthUtil, e.check.deflectionUtil, e.check.formingUtil)
    if (u > bu) {
      bu = u
      bi = i
    }
  })
  return bi
}

// ---------------------------------------------------------------------------
// 选型搜索：人工覆盖优先；建议阶段自动「抬档 → 加圈」
// ---------------------------------------------------------------------------

function searchSelection(l: Lantern, input: SolveInput) {
  const n = l.layers.length
  const maxC = BAMBOO.maxCourses
  const anyCourseOverride = input.courseOverrides.some((x) => x != null)

  const inner = Array.from({ length: n }, (_, i) => {
    const ov = input.courseOverrides[i]
    return ov == null ? 0 : Math.max(0, Math.min(maxC, Math.round(ov)))
  })
  // 人工层档覆盖；否则从 g2 起步
  let ringIdx = Array.from({ length: n }, (_, i) => {
    const ov = input.mode === 'byLayer' ? input.gradeOverrides[i] : null
    return ov ? GRADE_INDEX.get(ov)! : 1
  })
  let ribIdx = 1
  let evals: LayerSizingEvaluation[] = []

  for (let iter = 0; iter < 10; iter++) {
    const draft: SizingChoiceSignature = {
      mode: input.mode,
      verticalGradeId: BAMBOO.grades[ribIdx].id,
      layerGradeIds: ringIdx.map((i) => BAMBOO.grades[i].id),
      innerCourses: inner,
      totalCourses: inner.map((k) => k + 2)
    }
    const layout = buildLayout(l, inner)
    const inter = computeIntermediate(l, layout, draft)

    let changed = false
    evals = layout.segs.map((_, i) => {
      let gi = ringIdx[i]
      const plan = layout.layerPlans[i]
      let rc = ringMemberCheck(layout, plan, gi, inter, i)
      // 竖篾档全灯统一，先按当前 ribIdx 检
      let vc = ribMemberCheck(layout, i, ribIdx, inter)
      const gradeLocked = input.mode === 'byLayer' && !!input.gradeOverrides[i]
      const uniformLocked = input.mode === 'uniform' && !!input.uniformGradeId

      // 建议阶段：重量太大逐级抬档；弯得太急（仅逐层模式可行）逐级降档到能弯；
      // 跨度太长留给后面的加圈循环。
      if (!gradeLocked && !uniformLocked) {
        while (gi < LAST_G && rc.fail === 'weight') {
          gi++
          rc = ringMemberCheck(layout, plan, gi, inter, i)
          changed = true
        }
        if (input.mode === 'byLayer' && rc.fail === 'bend') {
          while (gi > 0) {
            gi--
            rc = ringMemberCheck(layout, plan, gi, inter, i)
            changed = true
            if (rc.fail !== 'bend') break
          }
        }
        if (vc.fail === 'weight') {
          let vi = ribIdx
          while (vi < LAST_G && (vc = ribMemberCheck(layout, i, vi, inter)).fail === 'weight') {
            vi++
            changed = true
          }
          ribIdx = Math.max(ribIdx, vi)
        }
      }
      ringIdx[i] = gi
      // 统一模式最终在 solveMode 里抬齐，这里先记录各层最低需求；搜索迭代中不构造补救路（避免递归重算）
      const ev = buildLayerEvaluation(l, layout, i, gi, Math.max(ribIdx, GRADE_INDEX.get(draft.verticalGradeId)!), inter, {
        ...input,
        courseOverrides: anyCourseOverrideLocked(input, inner)
      }, false)
      void vc
      return ev
    })

    // 建议阶段（无道数覆盖/统一锁档）：环或竖篾仍因跨度不通过的层，加一道圈缩短跨度
    if (!anyCourseOverride && !input.uniformGradeId) {
      let added = false
      evals.forEach((e) => {
        if (e.check.fail === 'span' && inner[e.layerIndex] < maxC) {
          inner[e.layerIndex]++
          added = true
          changed = true
        }
      })
      if (!added && !changed) break
    } else if (!changed) {
      break
    }
  }

  return { ringGradeIdx: ringIdx, ribGradeIdx: [ribIdx], innerCourses: inner }
}

/** 构造评估时实际生效的道数覆盖（建议自动加圈后，补救路应以当前 inner 为基准） */
function anyCourseOverrideLocked(input: SolveInput, inner: number[]): (number | null)[] {
  return inner.map((k, i) => (input.courseOverrides[i] != null ? input.courseOverrides[i] : k))
}

// ---------------------------------------------------------------------------
// 中间量：蒙面/扎线/LED/竹重的逐层归属（总重与逐层合计必须对得上）
// ---------------------------------------------------------------------------

function computeIntermediate(l: Lantern, layout: FrameLayout, choice: SizingChoiceSignature): Intermediate {
  const n = layout.segs.length
  const panels = buildPanels(l)
  const cov = coveringSpec(l.covering)

  // 蒙面（含缝份）：侧片归层；底盖归首层，顶盖归末层
  const coverLayerG = new Array(n).fill(0)
  for (const p of panels.panels) {
    const massG = (panelCutArea(p) * p.qty * cov.massPerM2) / 1_000_000
    if (p.layerIndex >= 0 && p.layerIndex < n) coverLayerG[p.layerIndex] += massG
    else if (p.label.includes('底')) coverLayerG[0] += massG
    else coverLayerG[n - 1] += massG
  }

  // 圈自重与归属（只在拥有层计一次）：
  //  - 多边形：周长 = n×边长，qty=n 根，每根 1 处接头余量 → stock = 周长 + n×lash
  //  - 旋转体：整圈 1 根，1 处接头余量 → stock = 周长 + lash
  const rings: Intermediate['rings'] = []
  for (const ring of layout.rings) {
    const gi = GRADE_INDEX.get(choice.layerGradeIds[ring.ownerLayerIndex])!
    const grade = BAMBOO.grades[gi]
    const qty = layout.polygon ? layout.n : 1
    const stock = ring.perimeterMm + qty * layout.lashMm
    rings.push({
      ring,
      gradeIndex: gi,
      stockMm: stock,
      selfG: stock * grade.widthMm * grade.thicknessMm * BAMBOO.densityGPerMm3
    })
  }

  const ribGrade = bambooGrade(choice.verticalGradeId)
  const ribOneStock = layout.ribRawMm + 2 * layout.lashMm
  const ribStockMm = ribOneStock * layout.n
  const ribLinearGPerMm = ribGrade.widthMm * ribGrade.thicknessMm * BAMBOO.densityGPerMm3

  // 扎线：圈接头处数沿用既有约定（圆形 1 / 多边形 n），归属拥有层；竖篾两端
  const jointsLayer = new Array(n).fill(0)
  for (const r of rings) jointsLayer[r.ring.ownerLayerIndex] += layout.polygon ? layout.n : 1
  const lashLayerG = jointsLayer.map((j) => j * CRAFT.lashPerJointM * BAMBOO.lashMassPerM)
  const ribLashG = 2 * layout.n * CRAFT.lashPerJointM * BAMBOO.lashMassPerM

  // 蒙面按全灯带分到各拥有圈（共享边界圈上下层各半），再回加得到层重，层和=蒙面总账
  const coverRingG = distributeCoverToRings(l, layout, coverLayerG)

  // 竹重逐层：圈归拥有层；竖篾按各层母线折线长占比
  const bambooLayerG = new Array(n).fill(0)
  for (const r of rings) bambooLayerG[r.ring.ownerLayerIndex] += r.selfG
  const ribTotalG = ribStockMm * ribLinearGPerMm
  const slantSum = layout.segs.reduce((s, x) => s + x.slantMm, 0) || 1
  layout.segs.forEach((sg, i) => (bambooLayerG[i] += ribTotalG * (sg.slantMm / slantSum)))

  // LED：按体积（既有规则），重量按各层高度占比，尾差并入末层
  const volL = bodyVolume(layout.geometry) / 1_000_000
  const ledCount = Math.max(CRAFT.led.min, Math.ceil(volL * CRAFT.led.perLiter))
  const ledLayerG = new Array(n).fill(0)
  const hSum = layout.segs.reduce((s, x) => s + x.heightMm, 0) || 1
  let ledAssigned = 0
  layout.segs.forEach((sg, i) => {
    let share: number
    if (i === n - 1) share = ledCount - ledAssigned
    else {
      share = Math.round((ledCount * sg.heightMm) / hSum)
      ledAssigned += share
    }
    ledLayerG[i] = share * CRAFT.led.massPerUnitG
  })

  // 每层蒙面 = 该层拥有圈分到的带（边界带天然上下各半）
  const coverOnOwnedLayerG = new Array(n).fill(0)
  for (const r of rings) {
    coverOnOwnedLayerG[r.ring.ownerLayerIndex] += coverRingG.get(r.ring.code) || 0
  }

  // 守恒断言：inter 圈自重合计必须 = 实例化构件行（n 根×每根含 1 处余量）
  if (typeof console !== 'undefined') {
    const ringSelf = rings.reduce((s, x) => s + x.selfG, 0)
    const memberRingSelf = materializeMembers(l, layout, choice)
      .filter((m) => m.kind === 'ring' || m.kind === 'mouth_ring' || m.kind === 'base_ring')
      .reduce((s, m) => s + m.lengthMm * m.qty * m.widthMm! * m.thicknessMm! * BAMBOO.densityGPerMm3, 0)
    if (Math.abs(ringSelf - memberRingSelf) > 0.05) {
      // 不打断流程，但在控制台暴露分叉（CHK-11 也会拦住）
      console.warn(`[sizing] 圈自重账不符 inter=${ringSelf.toFixed(2)}g members=${memberRingSelf.toFixed(2)}g`)
    }
  }

  // 逐层合计（竖篾扎线随竖篾按折线长占比并入）
  const layerG = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    layerG[i] = coverOnOwnedLayerG[i] + bambooLayerG[i] + lashLayerG[i] + ledLayerG[i] + ribLashG * (layout.segs[i].slantMm / slantSum)
  }

  return { rings, coverLayerG, coverRingG, lashLayerG, bambooLayerG, ledLayerG, layerG, ribLinearGPerMm, ribLashG }
}

function massOf(members: FrameMember[], inter: Intermediate): MassSummary {
  const bambooG = members.reduce(
    (s, m) => (m.kind === 'spoke' ? s : s + m.lengthMm * m.qty * m.widthMm! * m.thicknessMm! * BAMBOO.densityGPerMm3),
    0
  )
  const coveringG = inter.coverLayerG.reduce((s, x) => s + x, 0)
  const lashG = inter.lashLayerG.reduce((s, x) => s + x, 0) + inter.ribLashG
  const ledG = inter.ledLayerG.reduce((s, x) => s + x, 0)
  const totalG = bambooG + coveringG + lashG + ledG
  return {
    bambooG,
    coveringG,
    lashG,
    ledG,
    totalG,
    totalKg: Math.round(totalG / 100) / 10,
    layerMassG: inter.layerG
  }
}

// ---------------------------------------------------------------------------
// 圈荷载分配：蒙面按全灯带（相邻圈中线间）分到各拥有圈，共享边界带上下层各半
// ---------------------------------------------------------------------------

/**
 * 蒙面重量（g）分配到每道拥有圈：每层在自己的下→上高度区间内，按本层圈序切带
 *（首带层底→与下一道中线，末带中线→层顶，内部带在相邻中线间）；带权重 = 圆台/棱台
 * 侧面积 ∝ (R下+R上)×斜高，半径直接读轮廓 profile（既有几何，不重测）。每层总带权归一
 * 后分到本层各道圈（共享边界圈在本层拿内侧那片，邻层另拿一片，同 code 累加）。
 */
function distributeCoverToRings(l: Lantern, layout: FrameLayout, coverLayerG: number[]): Map<string, number> {
  void l
  const out = new Map<string, number>()
  const addTo = (code: string, g: number) => out.set(code, (out.get(code) || 0) + g)
  const profile = layout.geometry.profile
  const radiusAtY = (y: number): number => {
    if (y <= profile[0].y) return profile[0].x
    const last = profile[profile.length - 1]
    if (y >= last.y) return last.x
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1]
      const b = profile[i]
      if (y <= b.y) {
        const span = b.y - a.y
        return span < 1e-9 ? b.x : a.x + (b.x - a.x) * ((y - a.y) / span)
      }
    }
    return last.x
  }
  const bandWeight = (ya: number, yb: number) => {
    const ra = radiusAtY(ya)
    const rb = radiusAtY(yb)
    const dh = yb - ya
    const dr = rb - ra
    return (ra + rb) * Math.sqrt(Math.max(0, dh * dh + dr * dr))
  }

  layout.layerPlans.forEach((plan, li) => {
    const seg = layout.segs[li]
    const rs = plan.rings
    if (!rs.length) return
    const ys = rs.map((r) => r.yMm)
    const bounds: number[] = [seg.y0Mm]
    for (let k = 1; k < ys.length; k++) bounds.push((ys[k - 1] + ys[k]) / 2)
    bounds.push(seg.y1Mm)
    const weights = rs.map((r, k) => ({ code: r.code, w: bandWeight(bounds[k], bounds[k + 1]) }))
    const total = weights.reduce((sum, x) => sum + x.w, 0) || 1
    for (const x of weights) addTo(x.code, coverLayerG[li] * (x.w / total))
  })
  return out
}

function ringCoverG(inter: Intermediate, code: string): number {
  return inter.coverRingG.get(code) || 0
}

// ---------------------------------------------------------------------------
// 构件检核（简支梁 M=qL²/8、δ=5qL⁴/384EI；弯形 t≤εR）
// ---------------------------------------------------------------------------

function ringMemberCheck(
  layout: FrameLayout,
  plan: LayerCoursePlan,
  gradeIdx: number,
  inter: Intermediate,
  layerIdx: number
): MemberCheck {
  const owned = plan.rings.filter((r) => r.ownerLayerIndex === layerIdx)
  // 最不利圈：该层拥有圈中直径最大的（肚圈受竖载最狠；口圈半径小但弯形另行用热弯判）
  const ring = owned.reduce((a, b) => (b.radiusMm > a.radiusMm ? b : a), owned[0])
  const grade = BAMBOO.grades[gradeIdx]
  const span = ringSpan(layout, ring)
  const coverOnRingG = ringCoverG(inter, ring.code) || 0
  const selfPerMm = grade.widthMm * grade.thicknessMm * BAMBOO.densityGPerMm3
  // 圆形：整圈均摊到周长；多边形：该圈由 n 根直条合围，荷载按单根边长均摊
  const perimeterForLoad = layout.polygon ? ring.edgeMm : ring.perimeterMm
  const qGPerMm = coverOnRingG / (layout.polygon ? layout.n : 1) / Math.max(1, perimeterForLoad) + selfPerMm
  const qN = qGPerMm * N_PER_G
  const M = (qN * span * span) / 8
  const Z = (grade.thicknessMm * grade.widthMm * grade.widthMm) / 6
  const I = (grade.thicknessMm * grade.widthMm ** 3) / 12
  const strengthUtil = M / (Z * BAMBOO.allowableBendingNPerMm2)
  const defl = (5 * qN * span ** 4) / (384 * BAMBOO.elasticModulusNPerMm2 * I)
  const deflUtil = defl / (span / BAMBOO.deflectionRatio)
  // 成型：棱柱横篾是折角直条，不存在顺弯弯形（用最大折角判定，120°/135° 均可冷折）；
  // 旋转体圆肚圈用冷弯应变；上口收口圈按加湿/加热弯，用 allowableStrainMouth。
  let formUtil = 0
  if (!layout.polygon) {
    const strain = ring.isMouth ? BAMBOO.allowableStrainMouth : BAMBOO.allowableStrain
    formUtil = grade.thicknessMm / (strain * ring.radiusMm)
    // 口圈若比肚圈细：口圈档与肚圈同档（逐层档），此处用的是该层统一档，强度按肚圈即可
  }
  return classify(strengthUtil, deflUtil, formUtil, { span, radius: ring.radiusMm, grade, context: 'ring', mouth: ring.isMouth, polygon: layout.polygon })
}

function ribMemberCheck(layout: FrameLayout, layerIdx: number, ribGradeIdx: number, inter: Intermediate): MemberCheck {
  const seg = layout.segs[layerIdx]
  const span = layout.layerPlans[layerIdx].ribSpanMm
  const grade = BAMBOO.grades[ribGradeIdx]
  // 竖篾承担该层蒙面的 50%（工程假定），按 n 根均摊；层蒙面以全灯带分配后的圈带合计为准
  const coverOwned = layout.layerPlans[layerIdx].rings
    .filter((r) => r.ownerLayerIndex === layerIdx)
    .reduce((s, r) => s + ringCoverG(inter, r.code), 0)
  const coverOnRibG = (coverOwned * BAMBOO.coverLoadShareToRibs) / layout.n
  const selfPerMm = grade.widthMm * grade.thicknessMm * BAMBOO.densityGPerMm3
  const qGPerMm = coverOnRibG / Math.max(1, seg.slantMm) + selfPerMm
  const qN = qGPerMm * N_PER_G
  const M = (qN * span * span) / 8
  const Z = (grade.widthMm * grade.thicknessMm * grade.thicknessMm) / 6
  const I = (grade.widthMm * grade.thicknessMm ** 3) / 12
  const strengthUtil = M / (Z * BAMBOO.allowableBendingNPerMm2)
  const defl = (5 * qN * span ** 4) / (384 * BAMBOO.elasticModulusNPerMm2 * I)
  const deflUtil = defl / (span / BAMBOO.deflectionRatio)
  let formUtil = 0
  let R: number | null = null
  if (seg.drMm < -0.5) {
    const dr = Math.abs(seg.drMm)
    R = (seg.heightMm * seg.heightMm) / (2 * dr) + dr / 2
    // 竖篾顺收口肩部与口圈同为加湿/加热弯
    formUtil = grade.thicknessMm / (BAMBOO.allowableStrainMouth * R)
  }
  return classify(strengthUtil, deflUtil, formUtil, { span, radius: R, grade, context: 'rib', mouth: true })
}

function ringSpan(layout: FrameLayout, ring: RingPosition): number {
  return layout.polygon ? ring.edgeMm : 2 * ring.radiusMm * Math.sin(Math.PI / layout.n)
}

function classify(
  strengthUtil: number,
  deflUtil: number,
  formUtil: number,
  ctx: { span: number; radius: number | null; grade: BambooGrade; context: 'ring' | 'rib'; mouth?: boolean; polygon?: boolean }
): MemberCheck {
  const gi = GRADE_INDEX.get(ctx.grade.id)!
  if (Math.max(strengthUtil, deflUtil, formUtil) <= 1) {
    return { demandGradeIndex: gi, strengthUtil, deflectionUtil: deflUtil, formingUtil: formUtil }
  }
  let kind: FailureKind
  let detail: string
  if (formUtil > 1) {
    kind = 'bend'
    const strainWord = ctx.mouth ? '加湿/加热弯厚限' : '冷弯厚限'
    const eps = ctx.mouth ? BAMBOO.allowableStrainMouth : BAMBOO.allowableStrain
    detail =
      ctx.context === 'ring'
        ? `弯得太急：圈半径 ${ctx.radius!.toFixed(1)}mm，${ctx.grade.name}厚 ${ctx.grade.thicknessMm.toFixed(
            1
          )}mm 超过${strainWord} ${(eps * ctx.radius!).toFixed(1)}mm；换粗只会更弯，口圈得换薄一档或减小上口收分`
        : `弯得太急：收口肩部半径 ${ctx.radius!.toFixed(1)}mm，${ctx.grade.name}厚 ${ctx.grade.thicknessMm.toFixed(
            1
          )}mm 顺不过去（${strainWord} ${(eps * ctx.radius!).toFixed(1)}mm；换粗只会更弯，得换薄一档或减小上口收分）`
  } else if (deflUtil >= strengthUtil) {
    kind = 'span'
    detail = `跨度太长：支点跨度 ${ctx.span.toFixed(1)}mm，挠度利用率 ${(deflUtil * 100).toFixed(0)}%（下垂超限）`
  } else {
    kind = 'weight'
    detail = `重量太大：弯曲应力利用率 ${(strengthUtil * 100).toFixed(0)}%（截面抗弯模量不足）`
  }
  return { demandGradeIndex: -1, strengthUtil, deflectionUtil: deflUtil, formingUtil: formUtil, fail: kind, failDetail: detail }
}

// ---------------------------------------------------------------------------
// 逐层评估（含拦住说明与两条补救路）
// ---------------------------------------------------------------------------

// 补救路试算会再进 solveMode：用重入计数让内层只给判定、不再递归建补救路
let remedyDepth = 0

function buildEvaluations(
  l: Lantern,
  layout: FrameLayout,
  choice: SizingChoiceSignature,
  inter: Intermediate,
  input: SolveInput
): LayerSizingEvaluation[] {
  const coursesLocked = layout.innerCourses.map((k, i) => (input.courseOverrides[i] != null ? input.courseOverrides[i]! : k))
  const withRemedies = remedyDepth === 0
  return layout.segs.map((_, i) =>
    buildLayerEvaluation(l, layout, i, GRADE_INDEX.get(choice.layerGradeIds[i])!, GRADE_INDEX.get(choice.verticalGradeId)!, inter, {
      ...input,
      courseOverrides: coursesLocked
    }, withRemedies)
  )
}

function buildLayerEvaluation(
  l: Lantern,
  layout: FrameLayout,
  i: number,
  ringGi: number,
  ribGi: number,
  inter: Intermediate,
  input: SolveInput,
  withRemedies = true
): LayerSizingEvaluation {
  const seg = layout.segs[i]
  const plan = layout.layerPlans[i]
  const ringChk = ringMemberCheck(layout, plan, ringGi, inter, i)
  const ribChk = ribMemberCheck(layout, i, ribGi, inter)
  const check = mergeChecks(ringChk, ribChk)
  const ev: LayerSizingEvaluation = {
    layerIndex: i,
    heightMm: r1(seg.heightMm),
    diameterMm: r1(plan.rings.reduce((a, r) => Math.max(a, r.radiusMm), 0) * 2),
    tuckMm: r1(Math.max(0, seg.r0Mm - seg.r1Mm)),
    ribSpanMm: plan.ribSpanMm,
    totalCourses: plan.totalCourses,
    ringGrade: BAMBOO.grades[ringGi],
    ribGrade: BAMBOO.grades[ribGi],
    layerMassG: Math.round(inter.layerG[i] * 10) / 10,
    ring: ringViewOf(layout, i, ringGi, inter),
    rib: ribViewOf(layout, i, ribGi, inter),
    check
  }
  if (check.fail && withRemedies) {
    ev.blocked = {
      kind: check.fail,
      reason: [ringChk.failDetail, ribChk.failDetail].filter(Boolean).join('；'),
      remedies: buildRemedies(l, i, check.fail, input, ringGi)
    }
  }
  return ev
}

function mergeChecks(a: MemberCheck, b: MemberCheck): MemberCheck {
  const strengthUtil = Math.max(a.strengthUtil, b.strengthUtil)
  const deflectionUtil = Math.max(a.deflectionUtil, b.deflectionUtil)
  const formingUtil = Math.max(a.formingUtil, b.formingUtil)
  const fails = [a, b].filter((x) => x.fail)
  if (!fails.length) return { demandGradeIndex: -2, strengthUtil, deflectionUtil, formingUtil }
  const order: FailureKind[] = ['bend', 'span', 'weight']
  fails.sort((x, y) => order.indexOf(x.fail!) - order.indexOf(y.fail!))
  return {
    demandGradeIndex: -1,
    strengthUtil,
    deflectionUtil,
    formingUtil,
    fail: fails[0].fail,
    failDetail: fails.map((f) => f.failDetail).join('；')
  }
}

function ringViewOf(layout: FrameLayout, i: number, gi: number, inter: Intermediate): RingCheckView {
  const owned = layout.layerPlans[i].rings.filter((r) => r.ownerLayerIndex === i)
  const ring = owned.reduce((a, b) => (b.radiusMm > a.radiusMm ? b : a), owned[0])
  const grade = BAMBOO.grades[gi]
  const span = ringSpan(layout, ring)
  const coverG = ringCoverG(inter, ring.code) || 0
  const selfPerMm = grade.widthMm * grade.thicknessMm * BAMBOO.densityGPerMm3
  const perimeterForLoad = layout.polygon ? ring.edgeMm : ring.perimeterMm
  const qG = coverG / (layout.polygon ? layout.n : 1) / Math.max(1, perimeterForLoad) + selfPerMm
  const qN = qG * N_PER_G
  const M = (qN * span * span) / 8
  const Z = (grade.thicknessMm * grade.widthMm ** 2) / 6
  const I = (grade.thicknessMm * grade.widthMm ** 3) / 12
  const defl = (5 * qN * span ** 4) / (384 * BAMBOO.elasticModulusNPerMm2 * I)
  const strain = ring.isMouth ? BAMBOO.allowableStrainMouth : BAMBOO.allowableStrain
  return {
    yMm: ring.yMm,
    radiusMm: r1(ring.radiusMm),
    spanMm: r1(span),
    lineLoadGPerMm: Math.round(qG * 1e5) / 1e5,
    bendMomentNmm: Math.round(M * 100) / 100,
    demandSectionModulusMm3: r1(M / BAMBOO.allowableBendingNPerMm2),
    actualSectionModulusMm3: r1(Z),
    strengthUtil: M / (Z * BAMBOO.allowableBendingNPerMm2),
    deflectionMm: Math.round(defl * 100) / 100,
    deflectionLimitMm: Math.round((span / BAMBOO.deflectionRatio) * 100) / 100,
    deflectionUtil: defl / (span / BAMBOO.deflectionRatio),
    formingR: r1(ring.radiusMm),
    formingMaxThicknessMm: r1(strain * ring.radiusMm),
    formingUtil: layout.polygon ? 0 : grade.thicknessMm / (strain * ring.radiusMm)
  }
}

function ribViewOf(layout: FrameLayout, i: number, vi: number, inter: Intermediate): RibCheckView {
  const seg = layout.segs[i]
  const span = layout.layerPlans[i].ribSpanMm
  const grade = BAMBOO.grades[vi]
  const coverOwned = layout.layerPlans[i].rings
    .filter((r) => r.ownerLayerIndex === i)
    .reduce((s, r) => s + ringCoverG(inter, r.code), 0)
  const coverG = (coverOwned * BAMBOO.coverLoadShareToRibs) / layout.n
  const selfPerMm = grade.widthMm * grade.thicknessMm * BAMBOO.densityGPerMm3
  const qG = coverG / seg.slantMm + selfPerMm
  const qN = qG * N_PER_G
  const M = (qN * span * span) / 8
  const Z = (grade.widthMm * grade.thicknessMm ** 2) / 6
  const I = (grade.widthMm * grade.thicknessMm ** 3) / 12
  const defl = (5 * qN * span ** 4) / (384 * BAMBOO.elasticModulusNPerMm2 * I)
  let R: number | null = null
  if (seg.drMm < -0.5) {
    const dr = Math.abs(seg.drMm)
    R = (seg.heightMm * seg.heightMm) / (2 * dr) + dr / 2
  }
  return {
    spanMm: span,
    lineLoadGPerMm: Math.round(qG * 1e5) / 1e5,
    bendMomentNmm: Math.round(M * 100) / 100,
    strengthUtil: M / (Z * BAMBOO.allowableBendingNPerMm2),
    deflectionMm: Math.round(defl * 100) / 100,
    deflectionLimitMm: Math.round((span / BAMBOO.deflectionRatio) * 100) / 100,
    deflectionUtil: defl / (span / BAMBOO.deflectionRatio),
    formingR: R == null ? null : r1(R),
    formingMaxThicknessMm: R == null ? null : r1(BAMBOO.allowableStrainMouth * R),
    formingUtil: R == null ? 0 : grade.thicknessMm / (BAMBOO.allowableStrainMouth * R)
  }
}

// ---------------------------------------------------------------------------
// 两条补救路（基于当前求解输入做试算，代价量化）
// ---------------------------------------------------------------------------

function buildRemedies(l: Lantern, i: number, kind: FailureKind, input: SolveInput, currentGi: number): RemedyOption[] {
  const maxC = BAMBOO.maxCourses
  remedyDepth++
  try {
    return buildRemediesInner(l, i, kind, input, currentGi, maxC)
  } finally {
    remedyDepth--
  }
}

function buildRemediesInner(l: Lantern, i: number, kind: FailureKind, input: SolveInput, currentGi: number, maxC: number): RemedyOption[] {
  const before = solveMode(l, input)

  // ---- 路 A：换粗一档 ----
  const gradeViable = kind !== 'bend'
  const targetGi = Math.min(LAST_G, currentGi + 1)
  const gradeInput: SolveInput =
    input.mode === 'uniform'
      ? { ...input, uniformGradeId: BAMBOO.grades[targetGi].id }
      : { ...input, gradeOverrides: input.gradeOverrides.map((id, j) => (j === i ? BAMBOO.grades[targetGi].id : id)) }
  const gradeAfter = solveMode(l, gradeInput)
  const gradeAddG = gradeAfter.mass.bambooG - before.mass.bambooG

  const gradeRemedy: RemedyOption = {
    path: 'grade',
    viable: gradeViable && targetGi > currentGi && gradeAfter.passed,
    title:
      input.mode === 'uniform'
        ? `全灯换粗一档 → ${BAMBOO.grades[targetGi].name}`
        : `第 ${i + 1} 层换粗一档 → ${BAMBOO.grades[targetGi].name}`,
    target: {
      mode: input.mode,
      uniformGradeId: input.mode === 'uniform' ? BAMBOO.grades[targetGi].id : null,
      courseOverrides: input.courseOverrides,
      gradeOverrides: gradeInput.gradeOverrides
    },
    cost:
      input.mode === 'uniform'
        ? `全灯竖篾与各层横篾都升一档：仍是一种截面、备料省事；全灯竹重约 ${Math.abs(gradeAddG).toFixed(
            1
          )}g，上层更重、上口更难弯；按旧档已裁好刨好的那批篾要退回重新定规格。`
        : `只把第 ${i + 1} 层升到 ${BAMBOO.grades[targetGi].name}：该层更重，全灯竹重约 ${Math.abs(
            gradeAddG
          ).toFixed(1)}g；规格多一种，加工时这一层要单独分清、同批备料多出一档料。`,
    addedBambooG: Math.abs(gradeAddG),
    addedCourses: 0,
    wouldPass: gradeAfter.passed
  }
  if (kind === 'bend') {
    gradeRemedy.cost =
      '此路不通：弯得太急时换粗一档只会更弯（越厚越弯不动）；应改用薄一档做口圈（逐层模式）或减小上口收分后重算。'
  } else if (targetGi <= currentGi) {
    gradeRemedy.cost = '档库已到最粗（特粗篾 12.0×5.0mm），再粗只能单独定料、周期长且上口弯不动；建议改灯样参数。'
  }

  // ---- 路 B：多添一道横篾圈 ----
  const courseViable = kind !== 'bend' && input.courseOverrides[i]! < maxC
  const nextCourses = input.courseOverrides.map((k, j) => (j === i ? k! + 1 : k))
  const courseInput: SolveInput = { ...input, courseOverrides: nextCourses }
  const courseAfter = solveMode(l, courseInput)
  const addedPerim =
    courseAfter.layout.layerPlans[i].rings.reduce((s, r) => s + r.perimeterMm, 0) -
    before.layout.layerPlans[i].rings.reduce((s, r) => s + r.perimeterMm, 0)
  const spanBefore = before.layout.layerPlans[i].ribSpanMm
  const spanAfter = courseAfter.layout.layerPlans[i].ribSpanMm
  const jointsAdd = l.kind === 'revolution' ? 1 : Math.max(3, Math.round(l.sides))

  const courseRemedy: RemedyOption = {
    path: 'courses',
    viable: courseViable && courseAfter.passed,
    title: `第 ${i + 1} 层多添一道横篾圈（${before.choice.totalCourses[i]} → ${before.choice.totalCourses[i] + 1} 道）`,
    target: {
      mode: input.mode,
      uniformGradeId: input.uniformGradeId,
      courseOverrides: nextCourses,
      gradeOverrides: input.gradeOverrides
    },
    cost: `第 ${i + 1} 层圈道 ${before.choice.totalCourses[i]} → ${before.choice.totalCourses[i] + 1} 道：新增一圈周长约 ${
      addedPerim.toFixed(0)
    }mm（含接头余量、扎线 ${CRAFT.lashPerJointM.toFixed(1)}m、${jointsAdd} 处绑扎），竖篾跨度从 ${spanBefore.toFixed(
      0
    )}mm 缩到 ${spanAfter.toFixed(0)}mm；篾不用换粗、上口照弯，代价是多弯一圈、多绑扎 ${jointsAdd} 处、工时增加。`,
    addedBambooG: Math.max(0, courseAfter.mass.bambooG - before.mass.bambooG),
    addedCourses: 1,
    wouldPass: courseAfter.passed
  }
  if (kind === 'bend') courseRemedy.cost = '加圈解决不了弯得太急（口圈半径由灯样收口决定）；口圈只能换薄一档或减小收分。'
  if (!courseViable) courseRemedy.cost = `该层已达圈道上限 ${maxC + 2} 道，再加圈加工不现实，请换粗一档或改灯样。`

  return [gradeRemedy, courseRemedy]
}

// ---------------------------------------------------------------------------
// 多面体：棱篾灯，按 1 个「层」处理
// ---------------------------------------------------------------------------

function computePolyhedron(l: Lantern, mode: SizingMode): SizingResult {
  const layout = buildLayout(l, [])
  const grade = BAMBOO.grades[1]
  const choice = emptyChoice(1, mode, grade.id)
  const members = materializeMembers(l, layout, choice)
  const panels = buildPanels(l)
  const cov = coveringSpec(l.covering)
  const coverG = panels.panels.reduce((s, p) => s + (panelCutArea(p) * p.qty * cov.massPerM2) / 1_000_000, 0)
  const bambooG = members.reduce((s, m) => s + m.lengthMm * m.qty * m.widthMm! * m.thicknessMm! * BAMBOO.densityGPerMm3, 0)
  const joints = members.reduce((s, m) => s + m.qty * m.lashJoints, 0)
  const lashG = joints * CRAFT.lashPerJointM * BAMBOO.lashMassPerM
  const ledCount = Math.max(CRAFT.led.min, Math.ceil((bodyVolume(layout.geometry) / 1_000_000) * CRAFT.led.perLiter))
  const ledG = ledCount * CRAFT.led.massPerUnitG
  const totalG = bambooG + coverG + lashG + ledG
  const mass: MassSummary = {
    bambooG,
    coveringG: coverG,
    lashG,
    ledG,
    totalG,
    totalKg: Math.round(totalG / 100) / 10,
    layerMassG: [totalG]
  }
  const ev: LayerSizingEvaluation = {
    layerIndex: 0,
    heightMm: r1(layout.geometry.heightMm),
    diameterMm: r1(layout.geometry.maxR * 2),
    tuckMm: 0,
    ribSpanMm: r1(layout.polyEdgeMm!),
    totalCourses: 0,
    ringGrade: grade,
    ribGrade: grade,
    layerMassG: r1(totalG),
    ring: {
      yMm: 0,
      radiusMm: r1(layout.geometry.maxR),
      spanMm: r1(layout.polyEdgeMm!),
      lineLoadGPerMm: 0,
      bendMomentNmm: 0,
      demandSectionModulusMm3: 0,
      actualSectionModulusMm3: r1((grade.thicknessMm * grade.widthMm ** 2) / 6),
      strengthUtil: 0,
      deflectionMm: 0,
      deflectionLimitMm: 0,
      deflectionUtil: 0,
      formingR: 0,
      formingMaxThicknessMm: 0,
      formingUtil: 0
    },
    rib: {
      spanMm: r1(layout.polyEdgeMm!),
      lineLoadGPerMm: 0,
      bendMomentNmm: 0,
      strengthUtil: 0,
      deflectionMm: 0,
      deflectionLimitMm: r1(layout.polyEdgeMm! / BAMBOO.deflectionRatio),
      deflectionUtil: 0,
      formingR: null,
      formingMaxThicknessMm: null,
      formingUtil: 0
    },
    check: { demandGradeIndex: 1, strengthUtil: 0, deflectionUtil: 0, formingUtil: 0 }
  }
  return {
    l,
    layout,
    choice,
    recommended: { ...choice },
    overridesNote: '',
    grades: BAMBOO.grades,
    verticalGrade: grade,
    layerGrades: [grade],
    members,
    mass,
    layers: [ev],
    uniformNote: { mode: 'uniform', feasible: true, detail: '多面体棱篾灯只有棱篾一种构件，统一一档。' },
    byLayerNote: { mode: 'byLayer', feasible: true, detail: '多面体无层圈，逐层与统一结果相同。' },
    passed: true,
    worstLayer: 1,
    blockedCount: 0,
    modeTradeoff: '多面体棱篾灯只有棱篾一种构件，两种判定结果相同。',
    polyhedron: true
  }
}

// ---------------------------------------------------------------------------
// 构件实例化：layout 出行 → 挂选型截面
// ---------------------------------------------------------------------------

let memberSeq = 0
export function materializeMembers(l: Lantern, layout: FrameLayout, choice: SizingChoiceSignature): FrameMember[] {
  memberSeq = 0
  const raw = layoutMembers(layout, l)
  const verticalGrade = bambooGrade(choice.verticalGradeId)
  return raw.map((m) => {
    const grade =
      m.kind === 'ring' || m.kind === 'mouth_ring' || m.kind === 'base_ring'
        ? bambooGrade(choice.layerGradeIds[Math.max(0, m.layerIndex)] || choice.layerGradeIds[0])
        : verticalGrade
    const cross = `${r1(grade.widthMm)}×${r1(grade.thicknessMm)}`
    return {
      id: `FM${String(++memberSeq).padStart(3, '0')}`,
      kind: m.kind,
      label: m.label,
      lengthMm: r1(m.rawLengthMm + m.lashJoints * layout.lashMm),
      rawLengthMm: r1(m.rawLengthMm),
      gradeId: grade.id,
      gradeName: grade.name,
      widthMm: r1(grade.widthMm),
      thicknessMm: r1(grade.thicknessMm),
      layerIndex: m.layerIndex,
      courseNo: m.courseNo,
      bendRadiusMm: m.bendRadiusMm,
      bendAngleDeg: m.bendAngleDeg,
      qty: m.qty,
      group: m.kind === 'spoke' ? m.group : `${m.group} · ${grade.name} ${cross}mm`,
      lashJoints: m.lashJoints,
      note: m.note
    }
  })
}

function describeOverrides(rec: SizingChoiceSignature, cur: SizingChoiceSignature): string {
  const diffs: string[] = []
  if (rec.verticalGradeId !== cur.verticalGradeId) diffs.push(`竖篾 ${gradeName(rec.verticalGradeId)}→${gradeName(cur.verticalGradeId)}`)
  cur.layerGradeIds.forEach((id, i) => {
    if (id !== rec.layerGradeIds[i]) diffs.push(`第 ${i + 1} 层横篾 ${gradeName(rec.layerGradeIds[i])}→${gradeName(id)}`)
  })
  cur.totalCourses.forEach((k, i) => {
    if (k !== rec.totalCourses[i]) diffs.push(`第 ${i + 1} 层圈道 ${rec.totalCourses[i]}→${k} 道`)
  })
  return diffs.length ? `相对最小够用建议，当前人工指定：${diffs.join('；')}；选定的规格撑不住时不会自动放行。` : ''
}

function gradeName(id: string): string {
  return bambooGrade(id).name
}

// ---------------------------------------------------------------------------
// 快照 / 变更对照 / 台账
// ---------------------------------------------------------------------------

export function signatureOf(r: SizingResult): SizingChoiceSignature {
  return {
    mode: r.choice.mode,
    verticalGradeId: r.choice.verticalGradeId,
    layerGradeIds: [...r.choice.layerGradeIds],
    innerCourses: [...r.choice.innerCourses],
    totalCourses: [...r.choice.totalCourses]
  }
}

export function snapshotOf(r: SizingResult, version: number): SizingSnapshot {
  return {
    version,
    acceptedAt: new Date().toISOString(),
    choice: signatureOf(r),
    frameStockMm: r3(r.members.reduce((s, m) => s + m.lengthMm * m.qty, 0)),
    frameRawMm: r3(r.members.reduce((s, m) => s + m.rawLengthMm * m.qty, 0)),
    ringCountTotal: r.layout.rings.length,
    bambooMassG: Math.round(r.mass.bambooG * 10) / 10,
    coveringMassG: Math.round(r.mass.coveringG * 10) / 10,
    lashMassG: Math.round(r.mass.lashG * 10) / 10,
    ledMassG: Math.round(r.mass.ledG * 10) / 10,
    totalMassG: Math.round(r.mass.totalG * 10) / 10,
    passed: r.passed
  }
}

export interface SizingDiff {
  changed: boolean
  hasBaseline: boolean
  frame: { label: string; from: string; to: string }[]
  materials: { label: string; from: string; to: string }[]
  preview: { label: string; from: string; to: string }[]
  checks: { id: string; title: string; before: string; after: string; flippedToFail: boolean }[]
}

export function diffSizing(before: SizingSnapshot | null | undefined, after: SizingResult, afterChecks: CheckResult[]): SizingDiff {
  void afterChecks
  if (!before) return { changed: false, hasBaseline: false, frame: [], materials: [], preview: [], checks: [] }
  const frame: SizingDiff['frame'] = []
  const materials: SizingDiff['materials'] = []
  const preview: SizingDiff['preview'] = []
  const checks: SizingDiff['checks'] = []

  if (before.choice.verticalGradeId !== after.choice.verticalGradeId) {
    frame.push({ label: '竖篾宽厚', from: gradeText(before.choice.verticalGradeId), to: gradeText(after.choice.verticalGradeId) })
  }
  after.choice.layerGradeIds.forEach((id, i) => {
    if (id !== before.choice.layerGradeIds[i]) {
      frame.push({ label: `第 ${i + 1} 层横篾宽厚`, from: gradeText(before.choice.layerGradeIds[i]), to: gradeText(id) })
    }
  })
  after.choice.totalCourses.forEach((k, i) => {
    if (k !== before.choice.totalCourses[i]) {
      frame.push({ label: `第 ${i + 1} 层横篾圈道数`, from: `${before.choice.totalCourses[i]} 道`, to: `${k} 道` })
    }
  })

  const stockAfter = after.members.reduce((s, m) => s + m.lengthMm * m.qty, 0)
  pushNum(materials, '竹篾截取总长 (m)', before.frameStockMm / 1000, stockAfter / 1000, 3)
  pushNum(materials, '竹篾骨架重 (g)', before.bambooMassG, after.mass.bambooG, 1)
  pushNum(materials, '蒙面重 (g)', before.coveringMassG, after.mass.coveringG, 1)
  pushNum(materials, '扎线重 (g)', before.lashMassG, after.mass.lashG, 1)
  pushNum(materials, 'LED 含线重 (g)', before.ledMassG, after.mass.ledG, 1)
  pushNum(materials, '灯体总重 (g)', before.totalMassG, after.mass.totalG, 1)

  after.choice.totalCourses.forEach((k, i) => {
    if (k !== before.choice.totalCourses[i]) {
      preview.push({
        label: `第 ${i + 1} 层圈`,
        from: `${before.choice.totalCourses[i]} 道（${gradeText(before.choice.layerGradeIds[i])}）`,
        to: `${k} 道（${gradeText(after.choice.layerGradeIds[i])}）`
      })
    } else if (after.choice.layerGradeIds[i] !== before.choice.layerGradeIds[i]) {
      preview.push({
        label: `第 ${i + 1} 层圈截面`,
        from: gradeText(before.choice.layerGradeIds[i]),
        to: gradeText(after.choice.layerGradeIds[i])
      })
    }
  })

  const chk09 = afterChecks.find((c) => c.id === 'CHK-09')
  if (chk09) {
    checks.push({
      id: 'CHK-09',
      title: chk09.title,
      before: before.passed ? '通过（旧规格）' : '未通过',
      after: chk09.pass ? '通过' : '未通过',
      flippedToFail: before.passed && !chk09.pass
    })
  }
  for (const id of ['CHK-10', 'CHK-11']) {
    const c = afterChecks.find((x) => x.id === id)
    if (c) checks.push({ id, title: c.title, before: '通过', after: c.pass ? '通过' : '未通过', flippedToFail: !c.pass })
  }

  return {
    changed: frame.length + materials.length + preview.length + checks.filter((c) => c.before !== c.after).length > 0,
    hasBaseline: true,
    frame,
    materials,
    preview,
    checks
  }
}

function pushNum(out: { label: string; from: string; to: string }[], label: string, a: number, b: number, digits: number) {
  // 显示精度以内无差异才算未变（长度 0.001m / 重量 0.1g 的变化都列出来）
  const tol = 0.5 / Math.pow(10, digits)
  if (Math.abs(a - b) <= tol) return
  out.push({ label, from: a.toFixed(digits), to: b.toFixed(digits) })
}

function gradeText(id: string): string {
  const g = bambooGrade(id)
  return `${g.name} ${r1(g.widthMm)}×${r1(g.thicknessMm)}mm`
}

export function makeLedgerId(): string {
  return 'LE' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

export function ledgerEntry(
  kind: SizingLedgerEntry['kind'],
  reason: string,
  detail: string,
  fromVersion?: number,
  givenUp?: string
): SizingLedgerEntry {
  return { id: makeLedgerId(), at: new Date().toISOString(), kind, reason, detail, fromVersion, givenUp }
}
