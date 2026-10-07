/**
 * 灯样存储（Vue 自带响应式 + localStorage，无 Pinia/Vuex）
 * 灯型库与工艺参数来自本地打包 src/data/lantern-types.json，断网可用。
 */
import { reactive, watch } from 'vue'
import type { Lantern, SizingLedgerEntry, SizingMode, SizingSnapshot } from './types'
import { CRAFT, coveringSpec, presetById, PRESETS } from './craft'
import { buildGeometry, effectiveHeight, r1 } from './geometry'
import { computeSizing, ledgerEntry, snapshotOf, type RemedyOption, type SizingResult } from './sizing'

const KEY = 'lantern-frame-lofting.v1'

interface StoreState {
  lanterns: Lantern[]
  ready: boolean
  storageError: string
}

export const state = reactive<StoreState>({ lanterns: [], ready: false, storageError: '' })

let suspendPersist = false
let timer: number | undefined

function makeId(): string {
  return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function r1v(v: number): number {
  return Math.round(v * 10) / 10
}

/** 初始化竹篾选型核定状态（统一模式；档与道数先留空，由选型建议填） */
export function ensureSizingState(l: Lantern) {
  const n = Math.max(1, l.layers.length)
  if (!l.sizing) {
    l.sizing = {
      mode: 'uniform',
      uniformGradeId: null,
      courseOverrides: Array.from({ length: n }, () => null),
      gradeOverrides: Array.from({ length: n }, () => null),
      accepted: null,
      ledger: []
    }
  }
  const s = l.sizing
  while ((s.courseOverrides || []).length < n) s.courseOverrides!.push(null)
  while ((s.gradeOverrides || []).length < n) s.gradeOverrides!.push(null)
  s.courseOverrides = s.courseOverrides!.slice(0, n)
  s.gradeOverrides = s.gradeOverrides!.slice(0, n)
}

function pushLedger(l: Lantern, entry: SizingLedgerEntry) {
  ensureSizingState(l)
  l.sizing!.ledger = [entry, ...(l.sizing!.ledger || [])]
}

/** 依据灯型库预设新建灯样 */
export function createFromPreset(presetId: string): Lantern {
  const preset = presetById(presetId) || PRESETS[0]
  const p = preset.params
  const count = Math.max(1, Math.round(p.layerCount))
  const each = p.totalHeightMm / count
  const layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  // 保证分段高度之和 = 总高
  const sum = layers.reduce((s, x) => s + x.heightMm, 0)
  layers[layers.length - 1].heightMm = r1v(layers[layers.length - 1].heightMm + (p.totalHeightMm - sum))

  const now = new Date().toISOString()
  const lantern: Lantern = {
    id: makeId(),
    kind: preset.kind,
    name: preset.name,
    maxDiameterMm: p.maxDiameterMm,
    totalHeightMm: p.totalHeightMm,
    mouthDiameterMm: p.mouthDiameterMm,
    baseDiameterMm: p.baseDiameterMm,
    sides: p.sides,
    layers,
    mouthStyle: p.mouthStyle,
    bottomStyle: p.bottomStyle,
    smoothness: p.smoothness,
    ctrl1: p.ctrl1 ? { ...p.ctrl1 } : { x: 0.12, y: 0.3 },
    ctrl2: p.ctrl2 ? { ...p.ctrl2 } : { x: 0.85, y: 0.78 },
    divisions: p.divisions ?? CRAFT.defaultDivisions,
    covering: p.covering,
    seamAllowanceMm: CRAFT.defaultSeamAllowanceMm,
    lashAllowanceMm: CRAFT.defaultLashAllowanceMm,
    layerColors: [...p.layerColors],
    color: p.color,
    batchCount: 20,
    wasteRatio: coveringSpec(p.covering).wasteRatio,
    pageSize: 'A4',
    overlapMm: CRAFT.defaultOverlapMm,
    createdAt: now,
    updatedAt: now
  }
  syncLayerDiameters(lantern)
  ensureSizingState(lantern)
  return lantern
}

/** 把轮廓算出的直径写回分段（数据模型 §7 中 layers[].diameterMm） */
export function syncLayerDiameters(l: Lantern) {
  const g = buildGeometry(l)
  l.layers.forEach((ly, i) => {
    const sec = g.sections[i + 1]
    if (sec) ly.diameterMm = r1(sec.radiusMm * 2)
  })
  l.totalHeightMm = r1(effectiveHeight(l))
}

/** 分段高度均分（改总高/层数时调用） */
export function distributeLayers(l: Lantern) {
  const count = Math.max(1, Math.round(l.layers.length))
  const each = l.totalHeightMm / count
  l.layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  const sum = l.layers.reduce((s, x) => s + x.heightMm, 0)
  l.layers[count - 1].heightMm = r1v(l.layers[count - 1].heightMm + (l.totalHeightMm - sum))
  while (l.layerColors.length < count) l.layerColors.push(l.color)
  l.layerColors = l.layerColors.slice(0, count)
  ensureSizingState(l)
  // 层数变了：逐层档/道数覆盖全部失效，回到建议
  l.sizing!.courseOverrides = Array.from({ length: count }, () => null)
  l.sizing!.gradeOverrides = Array.from({ length: count }, () => null)
  l.sizing!.uniformGradeId = null
  syncLayerDiameters(l)
  invalidateAccepted(l, '层数变化', `分段层数调整为 ${count} 层，旧版构件表分组、绑扎余量与受力结论一并失效。`)
}

export function addLantern(l: Lantern) {
  state.lanterns.unshift(l)
  return l
}

export function getLantern(id: string): Lantern | undefined {
  const l = state.lanterns.find((x) => x.id === id)
  if (l) ensureSizingState(l)
  return l
}

export function duplicateLantern(id: string): Lantern | undefined {
  const src = getLantern(id)
  if (!src) return undefined
  const copy: Lantern = JSON.parse(JSON.stringify(src))
  copy.id = makeId()
  copy.name = src.name + ' 副本'
  copy.createdAt = copy.updatedAt = new Date().toISOString()
  // 副本是另一盏灯：选型结论/台账不跟随，需重新核定
  copy.sizing = {
    mode: src.sizing?.mode || 'uniform',
    uniformGradeId: null,
    courseOverrides: (src.sizing?.courseOverrides || []).map(() => null),
    gradeOverrides: (src.sizing?.gradeOverrides || []).map(() => null),
    accepted: null,
    lastVoided: null,
    ledger: []
  }
  ensureSizingState(copy)
  state.lanterns.unshift(copy)
  return copy
}

export function removeLantern(id: string) {
  const i = state.lanterns.findIndex((l) => l.id === id)
  if (i >= 0) state.lanterns.splice(i, 1)
}

function persistNow() {
  suspendPersist = true
  try {
    for (const l of state.lanterns) syncLayerDiameters(l)
    localStorage.setItem(KEY, JSON.stringify({ version: 1, lanterns: state.lanterns }))
    state.storageError = ''
  } catch (e) {
    state.storageError = e instanceof Error ? e.message : String(e)
  } finally {
    suspendPersist = false
  }
}

function schedulePersist() {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = undefined
    persistNow()
  }, 180)
}

/** 载入本地灯样；首次进入预置一个六角宫灯，便于立即放样 */
export function loadStore() {
  if (state.ready) return
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as { lanterns?: Lantern[] }
      if (Array.isArray(data.lanterns)) {
        state.lanterns = data.lanterns
        // 老版本灯样迁移：补齐竹篾选型状态
        for (const l of state.lanterns) ensureSizingState(l)
      }
    }
  } catch {
    state.storageError = '本地灯样数据损坏，已重置'
  }
  if (state.lanterns.length === 0) {
    state.lanterns.push(createFromPreset('hex-palace'))
  }
  state.ready = true
  watch(
    () => state.lanterns,
    () => {
      if (suspendPersist) return
      schedulePersist()
    },
    { deep: true }
  )
  persistNow()
}

/**
 * 灯样参数变更后：若与已存档结论不符，把旧版结论连同本机灯样/已导出备料单一起作废。
 * 由各参数输入处显式调用（不挂在 syncLayerDiameters 上，避免持久化时误作废）。
 */
export function invalidateAccepted(l: Lantern, reason: string, detail: string, givenUp?: string): SizingResult | null {
  ensureSizingState(l)
  const accepted = l.sizing!.accepted
  if (!accepted) return null
  const r = computeSizing(l)
  // 参数变更一律重算并作废旧版（规格档可能不变，但长度/重量/受力已是另一组数）
  l.sizing!.accepted = null
  l.sizing!.lastVoided = accepted
  pushLedger(
    l,
    ledgerEntry(
      'void-param',
      reason,
      `${detail} 已存档的第 ${accepted.version} 版结论与已导出的备料单一并作废；按旧规格裁好刨好的那批篾退回重新定规格。`,
      accepted.version,
      givenUp
    )
  )
  return r
}

/** 当前计算结果（每次调用都是同一份灯样参数下的全新核算） */
export function currentSizing(l: Lantern): SizingResult {
  ensureSizingState(l)
  return computeSizing(l)
}

/** 核定当前结论存档（只有撑得住才允许） */
export function acceptSizing(l: Lantern): { ok: boolean; error?: string; result?: SizingResult } {
  ensureSizingState(l)
  const r = computeSizing(l)
  if (!r.passed) {
    return { ok: false, error: `第 ${r.blockedCount} 层撑不住，不能核定；请先在拦住卡片里选一条补救路。`, result: r }
  }
  const version = ((l.sizing!.accepted || l.sizing!.lastVoided)?.version || 0) + 1
  const snap: SizingSnapshot = snapshotOf(r, version)
  const hadPrior = !!(l.sizing!.accepted || l.sizing!.lastVoided)
  l.sizing!.accepted = snap
  l.sizing!.lastVoided = null
  pushLedger(
    l,
    ledgerEntry(
      'accept',
      '核定存档',
      `第 ${version} 版选型核定通过并存入本机：竖篾 ${r.verticalGrade.name} ${r.verticalGrade.widthMm.toFixed(1)}×${r.verticalGrade.thicknessMm.toFixed(
        1
      )}mm；各层圈道 ${r.choice.totalCourses.join('/')}；竹重 ${snap.bambooMassG.toFixed(1)}g、总重 ${snap.totalMassG.toFixed(1)}g。${
        hadPrior ? '此前旧版结论与已导出备料单已作废，以此版为准下料。' : ''
      }`
    )
  )
  return { ok: true, result: r }
}

/** 切换判定方式（统一/逐层）：选错的一版连同存档与备料单作废重来 */
export function setSizingMode(l: Lantern, mode: SizingMode) {
  ensureSizingState(l)
  if (l.sizing!.mode === mode) return
  const old = l.sizing!
  const oldR = computeSizing(l)
  // 被放弃的判定方式让出的代价
  const givenUp =
    mode === 'uniform'
      ? `放弃「逐层各选一档」：让出的是省料省重（逐层竹重 ${oldR.mass.bambooG.toFixed(
          1
        )}g），换来全灯统一一档的备料简单与加工省事。`
      : `放弃「全灯统一一档」：让出的是备料简单、加工省事（统一竹重 ${oldR.mass.bambooG.toFixed(
          1
        )}g），换来逐层省料省重，代价是规格变多、加工分层分清。`
  const oldVersion = old.accepted?.version
  if (old.accepted) old.lastVoided = old.accepted
  old.mode = mode
  old.uniformGradeId = null
  old.accepted = null
  pushLedger(
    l,
    ledgerEntry(
      'void-mode',
      '判定方式切换',
      `由「${mode === 'uniform' ? '逐层各选一档' : '全灯统一一档'}」改判为「${
        mode === 'uniform' ? '全灯统一一档' : '逐层各选一档'
      }」：选错的那一版结论、本机灯样存档与已导出备料单全部作废重来，按旧规格已裁刨的篾退回重新定规格，旧版构件表分组、绑扎余量与受力结论失效。`,
      oldVersion,
      givenUp
    )
  )
}

/** 应用某一层的补救路（换粗一档 / 多添一道圈），落账并写清被放弃那条路让出的代价 */
export function applyRemedy(l: Lantern, layerIndex: number, chosen: RemedyOption) {
  ensureSizingState(l)
  const other = chosen.path === 'grade' ? 'courses' : 'grade'
  const r0 = computeSizing(l)
  const block = r0.layers[layerIndex]?.blocked
  const abandoned = block?.remedies.find((x) => x.path === other)
  const oldVersion = l.sizing!.accepted?.version
  if (l.sizing!.accepted) {
    l.sizing!.lastVoided = l.sizing!.accepted
    l.sizing!.accepted = null
  }

  l.sizing!.mode = chosen.target.mode
  if (chosen.target.mode === 'uniform') {
    l.sizing!.uniformGradeId = chosen.target.uniformGradeId
  } else {
    l.sizing!.uniformGradeId = null
    l.sizing!.gradeOverrides = chosen.target.gradeOverrides ? chosen.target.gradeOverrides.map((x) => x) : l.sizing!.gradeOverrides
  }
  l.sizing!.courseOverrides = chosen.target.courseOverrides.map((x) => x)

  pushLedger(
    l,
    ledgerEntry(
      'remedy',
      `第 ${layerIndex + 1} 层撑不住，采用「${chosen.path === 'grade' ? '换粗一档' : '多添一道横篾圈'}」`,
      `采纳：${chosen.title}；代价：${chosen.cost}`,
      oldVersion,
      abandoned ? `放弃另一条路「${abandoned.title}」：它让出的代价是——${abandoned.cost}` : undefined
    )
  )
}

/** 人工指定统一档（撑不住时不自动放行，由 CHK-09 拦住） */
export function setUniformGrade(l: Lantern, gradeId: string | null) {
  ensureSizingState(l)
  l.sizing!.uniformGradeId = gradeId
}

/** 人工调整某层内部加圈道数 */
export function setLayerCourses(l: Lantern, layerIndex: number, inner: number) {
  ensureSizingState(l)
  l.sizing!.courseOverrides![layerIndex] = Math.max(0, Math.min(9, Math.round(inner)))
}

/** 人工调整某层档（逐层模式） */
export function setLayerGrade(l: Lantern, layerIndex: number, gradeId: string | null) {
  ensureSizingState(l)
  l.sizing!.gradeOverrides![layerIndex] = gradeId
}

export function useLanternStore() {
  return {
    state,
    createFromPreset,
    addLantern,
    getLantern,
    duplicateLantern,
    removeLantern,
    distributeLayers,
    syncLayerDiameters,
    ensureSizingState,
    currentSizing,
    acceptSizing,
    setSizingMode,
    applyRemedy,
    setUniformGrade,
    setLayerCourses,
    setLayerGrade,
    invalidateAccepted
  }
}
