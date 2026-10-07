<script setup lang="ts">
/**
 * 竹篾规格选型核定面板
 * 数据全部来自 core/selection（构件表/材料/预览/自检四处同一份结论）。
 * full=true（骨架件表页）：完整核定台；false（参数预览页）：结论摘要。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { Lantern, SelectionMode } from '../core/types'
import {
  applyMode,
  applyRemedy,
  computeSelection,
  confirmSelection,
  setExtraRing,
  setGrade,
  type GradeSelector,
  type Remedy,
  type SelectionResult
} from '../core/selection'
import { BAMBOO, gradeById, gradeStroke } from '../core/craft'

const props = defineProps<{ lantern: Lantern; full?: boolean }>()

const res = computed<SelectionResult>(() => computeSelection(props.lantern))
const full = computed(() => props.full !== false)

const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)
const f3 = (v: number) => v.toFixed(3)

const modeLabel = (m: SelectionMode) => (m === 'uniform' ? '全灯统一一档' : '逐层各选一档')

/** 各选择子最不利的一条受力考核（避免表格过长） */
const worstDemands = computed(() => {
  const map = new Map<string, (typeof res.value.demands)[number]>()
  for (const d of res.value.demands) {
    const cur = map.get(d.selector)
    const score = (x: typeof d) => Math.max(x.ratios.span, x.ratios.stress, x.ratios.sag, x.ratios.bend, x.ratios.tension)
    if (!cur || score(d) > score(cur)) map.set(d.selector, d)
  }
  return [...map.entries()].map(([selector, d]) => ({ selector: selector as GradeSelector, d }))
})

function selectorLabel(sel: GradeSelector): string {
  if (sel === 'rib') return '竖篾/母线篾'
  const j = Number(sel.slice(5))
  const L = props.lantern.layers.length
  if (j === 0) return '底盘圈'
  if (j === L) return '收口圈'
  return `第 ${j} 层圈`
}

function currentGradeId(sel: GradeSelector): string {
  return sel === 'rib' ? res.value.config.ribGrade : res.value.config.ringGrades[Number(sel.slice(5))]
}

function choose(sel: GradeSelector, e: Event) {
  setGrade(props.lantern, sel, (e.target as HTMLSelectElement).value)
}

function onMode(m: SelectionMode) {
  applyMode(props.lantern, m)
}

function takeRemedy(r: Remedy) {
  applyRemedy(props.lantern, r)
}

function onExtra(band: number, e: Event) {
  setExtraRing(props.lantern, band, Number((e.target as HTMLSelectElement).value))
}

function doConfirm() {
  const out = confirmSelection(props.lantern)
  if (!out.ok) window.alert(out.error || '当前选型撑不住，不能确认。')
}

const ratioPct = (v: number) => `${Math.round(v * 100)}%`
const ratioClass = (v: number) => (v > 1 ? 'bad' : v > 0.85 ? 'warn' : 'ok')

const voidedExports = computed(() => res.value.exports.filter((e) => e.voided))
const activeExports = computed(() => res.value.exports.filter((e) => !e.voided))

const confirmTime = computed(() =>
  props.lantern.selection.confirmedAt ? new Date(props.lantern.selection.confirmedAt).toLocaleString() : ''
)

/** 确认按钮仅在「撑得住 且 还没按当前参数确认」时可用 */
const canConfirm = computed(() => res.value.pass && res.value.stale)
</script>

<template>
  <section class="spec" :class="{ compact: !full }">
    <!-- 结论横幅 -->
    <header class="banner" :class="res.pass ? (res.stale ? 'stale' : 'ok') : 'fail'">
      <div class="b-main">
        <span class="b-tag">竹篾规格选型核定 · R{{ lantern.selection.revision || 0 }}</span>
        <h3 v-if="res.pass && !res.stale">
          核定通过：{{ res.polyMode ? '棱篾' : '竖篾' }} {{ res.config.ribGrade }}
          （{{ gradeById(res.config.ribGrade).name }}，{{ f1(gradeById(res.config.ribGrade).widthMm) }}×{{ f1(gradeById(res.config.ribGrade).thicknessMm) }}mm）
          <template v-if="!res.polyMode">
            ；各层圈 {{ new Set(res.config.ringGrades).size }} 种档、补加横篾圈
            {{ res.config.extraRings.reduce((s, x) => s + x, 0) }} 道
          </template>
        </h3>
        <h3 v-else-if="!res.pass">撑不住，已当场拦住（{{ res.failures.length }} 处）——先从下面两条路里选一条</h3>
        <h3 v-else>参数已改动，旧版选型结论失效，需要重新核定确认</h3>
        <p class="b-sub">
          判定方式：<b>{{ modeLabel(res.config.mode) }}</b>
          <template v-if="!res.polyMode">
            ｜备料总长 {{ f3(res.stockLengthMm / 1000) }}m｜骨架自重 {{ f1(res.frameMassG) }}g｜
            整灯总重 {{ f1(res.ledger.totalG) }}g（{{ f3(res.ledger.totalKg) }}kg，{{ f2(res.ledger.totalN) }}N）
          </template>
          <template v-else>
            ｜棱篾备料 {{ f3(res.stockLengthMm / 1000) }}m｜总重 {{ f1(res.ledger.totalG) }}g
          </template>
          <span v-if="confirmTime && !res.stale" class="b-time">｜确认于 {{ confirmTime }}</span>
        </p>
      </div>
      <button v-if="full" class="confirm" :disabled="!canConfirm" @click="doConfirm">
        {{ lantern.selection.revision === 0 ? '确认选型结论（R1）' : `重新确认（R${lantern.selection.revision + 1}）` }}
      </button>
      <router-link v-else class="confirm-link" :to="`/frame/${lantern.id}`">
        {{ res.stale || !res.pass ? '去骨架件表核定选型 →' : '查看选型核定 →' }}
      </router-link>
    </header>

    <!-- 二选一：判定方式 -->
    <div v-if="!res.polyMode" class="modes">
      <button
        v-for="m in (['uniform', 'perlayer'] as SelectionMode[])"
        :key="m"
        class="mode"
        :class="{ on: res.config.mode === m }"
        @click="onMode(m)"
      >
        <b>{{ modeLabel(m) }}</b>
        <span>
          {{ m === 'uniform' ? '备料简单、加工省事' : '省料省重' }}
          ｜{{ m === 'uniform' ? '上层更重、上口更难弯' : '规格多、加工要分层分清' }}
          ｜规格
          {{ new Set([...(m === 'uniform' ? res.modes.uniform.config.ringGrades : res.modes.perlayer.config.ringGrades), (m === 'uniform' ? res.modes.uniform.config.ribGrade : res.modes.perlayer.config.ribGrade)]).size }} 种
          ｜骨架 {{ f1(m === 'uniform' ? res.modes.uniform.frameMassG : res.modes.perlayer.frameMassG) }}g
          ｜备料 {{ f3((m === 'uniform' ? res.modes.uniform.frameMm : res.modes.perlayer.frameMm) / 1000) }}m
        </span>
      </button>
    </div>

    <!-- 被拦：原因 + 两条路 -->
    <div v-if="!res.pass" class="blocked">
      <h4>拦住原因（写清是哪一种）</h4>
      <ul class="fail-list">
        <li v-for="(f, i) in (full ? res.failures : res.failures.slice(0, 3))" :key="i" class="fail-item">
          <span class="reason" :class="f.reason">{{ f.reasonText }}</span>
          <span class="where">{{ f.member.label }}</span>
          <span class="detail">{{ f.detail }}</span>
        </li>
      </ul>

      <h4>两条能走的办法（代价都摆出来，自己取舍一条）</h4>
      <div class="remedies">
        <article v-for="r in res.remedies" :key="r.id" class="remedy" :class="{ dead: !r.feasible }">
          <header>
            <b>{{ r.title }}</b>
            <span class="tag" :class="r.residualPass ? 'yes' : 'no'">
              {{ !r.feasible ? '此路不通' : r.residualPass ? '走完即通过' : '走完仍拦' }}
            </span>
          </header>
          <p class="cost"><label>材料：</label>{{ r.costMaterial }}</p>
          <p class="cost"><label>加工：</label>{{ r.costCraft }}</p>
          <p v-if="r.cannotFix" class="cannot">⚠ {{ r.cannotFix }}</p>
          <button :disabled="!r.feasible" @click="takeRemedy(r)">走这条（应用后重新过核定）</button>
        </article>
      </div>
      <p v-if="res.remedies.length && res.remedies.every((r) => !r.residualPass)" class="cannot both">
        这两条在当前「{{ modeLabel(res.config.mode) }}」下都压不住：多半是最不利处在上口弯弧、统一档把上层也带粗了。
        改走上面的<b>「逐层各选一档」</b>（上口保留细篾、只把承重层加粗），或在下方逐处手动给收口圈换细一档，再重过核定。
      </p>
    </div>

    <!-- 放弃方案的代价 -->
    <p v-if="res.abandonedPathNote" class="abandoned">↩ {{ res.abandonedPathNote }}</p>

    <!-- 手动定档 + 补圈道数（完整版） -->
    <template v-if="full">
      <div v-if="!res.polyMode" class="assign">
        <h4>逐处定档与补圈（也可直接在这里改，结论立即重算）</h4>
        <table>
          <thead>
            <tr>
              <th>位置</th>
              <th>选定规格（宽×厚 mm）</th>
              <th class="num">该层补加横篾圈（道）</th>
              <th class="num">净跨 (mm)</th>
              <th class="num">跨/限</th>
              <th class="num">应力比</th>
              <th class="num">挠度比</th>
              <th class="num">弯弧比</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="{ selector, d } in worstDemands" :key="selector">
              <td>{{ selectorLabel(selector) }}</td>
              <td>
                <select :value="currentGradeId(selector)" @change="choose(selector, $event)">
                  <option v-for="g in BAMBOO.grades" :key="g.id" :value="g.id">
                    {{ g.id }} {{ g.name }} {{ f1(g.widthMm) }}×{{ f1(g.thicknessMm) }}
                  </option>
                </select>
              </td>
              <td class="num">
                <select
                  v-if="selector !== 'rib'"
                  :value="res.config.extraRings[Math.min(Number(selector.slice(5)), lantern.layers.length - 1)] ?? 0"
                  @change="onExtra(Math.min(Number(selector.slice(5)), lantern.layers.length - 1), $event)"
                >
                  <option v-for="k in BAMBOO.maxExtraRingsPerBand + 1" :key="k - 1" :value="k - 1">{{ k - 1 }}</option>
                </select>
                <span v-else>—</span>
              </td>
              <td class="num mono">{{ f1(d.spanMm) }}</td>
              <td class="num mono" :class="ratioClass(d.ratios.span)">{{ ratioPct(d.ratios.span) }}</td>
              <td class="num mono" :class="ratioClass(d.ratios.stress)">{{ ratioPct(d.ratios.stress) }}</td>
              <td class="num mono" :class="ratioClass(d.ratios.sag)">{{ ratioPct(d.ratios.sag) }}</td>
              <td class="num mono" :class="ratioClass(d.ratios.bend)">
                {{ d.bendRNeedMm === undefined ? '折角' : ratioPct(d.ratios.bend) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 逐层受力账 -->
      <div class="ledger">
        <h4>逐层受力账（重量 g；逐层合计与整灯总重严格一致，见 CHK-11）</h4>
        <table v-if="!res.polyMode">
          <thead>
            <tr>
              <th>层</th>
              <th class="num">层高 (mm)</th>
              <th class="num">蒙面+胶 (g)</th>
              <th class="num">扎线 (g)</th>
              <th class="num">LED (g)</th>
              <th class="num">竖篾自重 (g)</th>
              <th class="num">层小计 (g)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in res.ledger.bands" :key="b.bandIndex">
              <td>第 {{ b.bandIndex + 1 }} 层</td>
              <td class="num mono">{{ f1(b.heightMm) }}</td>
              <td class="num mono">{{ f1(b.coverGlueG) }}</td>
              <td class="num mono">{{ f1(b.threadG) }}</td>
              <td class="num mono">{{ f1(b.ledG) }}</td>
              <td class="num mono">{{ f1(b.ribSelfG) }}</td>
              <td class="num mono strong">{{ f1(b.subtotalG) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="6">各层合计 ＋ 顶盖 {{ f1(res.ledger.capTopG) }}g ＋ 底盖 {{ f1(res.ledger.capBottomG) }}g ＋ 横篾圈自重 {{ f1(res.ledger.ringSelfG) }}g</td>
              <td class="num mono strong">＝ {{ f1(res.ledger.totalG) }}g</td>
            </tr>
          </tfoot>
        </table>

        <h4 class="mt">各横篾圈受力（含补加圈）</h4>
        <table>
          <thead>
            <tr>
              <th>圈</th>
              <th class="num">半径 (mm)</th>
              <th class="num">补加道</th>
              <th class="num">圈自重 (g)</th>
              <th class="num">蒙面分摊 (g)</th>
              <th class="num">端盖 (g)</th>
              <th class="num">合计 (g)</th>
              <th class="num">换算 (N)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in res.ringLoads" :key="r.nodeIndex">
              <td>{{ r.label }}</td>
              <td class="num mono">{{ f1(r.radiusMm) }}</td>
              <td class="num mono">{{ r.extraCourse }}</td>
              <td class="num mono">{{ f1(r.ringSelfG) }}</td>
              <td class="num mono">{{ f1(r.coverShareG) }}</td>
              <td class="num mono">{{ f1(r.capG) }}</td>
              <td class="num mono">{{ f1(r.totalG) }}</td>
              <td class="num mono">{{ f2(r.totalN) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分规格用料 -->
      <div class="grades">
        <h4>分规格竹篾用料（备料统计与材料页按同一份结论取数）</h4>
        <table>
          <thead>
            <tr>
              <th>规格档</th>
              <th class="num">宽 (mm)</th>
              <th class="num">厚 (mm)</th>
              <th class="num">线宽色（预览）</th>
              <th class="num">根数</th>
              <th class="num">截取总长 (mm)</th>
              <th class="num">重 (g)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="gl in res.gradeLengths" :key="gl.grade.id" :class="{ zero: gl.lengthMm === 0 }">
              <td>{{ gl.grade.id }} {{ gl.grade.name }}</td>
              <td class="num mono">{{ f1(gl.grade.widthMm) }}</td>
              <td class="num mono">{{ f1(gl.grade.thicknessMm) }}</td>
              <td class="num"><span class="sw" :style="{ background: gradeStroke(gl.grade).color, height: gradeStroke(gl.grade).widthMm + 'px' }" /></td>
              <td class="num mono">{{ gl.qty }}</td>
              <td class="num mono">{{ f1(gl.lengthMm) }}</td>
              <td class="num mono">{{ f1(gl.massG) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 旧版作废 / 已裁篾退回提示 -->
    <div v-if="voidedExports.length" class="voidbox">
      <h4>旧版结论与已导出单据已作废（共 {{ voidedExports.length }} 份）</h4>
      <ul>
        <li v-for="(e, i) in voidedExports.slice(0, 6)" :key="i">
          {{ e.filename }}（R{{ e.revision }}，{{ new Date(e.at).toLocaleString() }}）— 已作废
        </li>
      </ul>
      <p class="redo">
        按旧规格已经裁好、刨好的那批篾<b>退回重新定规格</b>；旧版构件表分组、绑扎余量与受力结论全部失效。
        新结论确认（版次 +1）前，备料单/构件清单不允许导出。
      </p>
    </div>
    <p v-else-if="res.stale && lantern.selection.revision > 0" class="redo small">
      灯样参数已改：本机灯样里的旧版选型（R{{ lantern.selection.revision }}）与旧备料单一起作废，需重新核定。
    </p>
    <p v-if="activeExports.length && !res.stale" class="exports-ok">
      当前版次有效导出 {{ activeExports.length }} 份（{{ activeExports.map((e) => e.filename).join('、') }}）。
    </p>
  </section>
</template>

<style scoped>
.spec {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 16px;
  flex-wrap: wrap;
}
.banner.ok {
  background: #eef7f1;
  border-bottom: 2px solid var(--jade);
}
.banner.fail {
  background: #fdecea;
  border-bottom: 2px solid var(--red);
}
.banner.stale {
  background: #fff7e6;
  border-bottom: 2px solid var(--gold);
}
.b-tag {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--ink-soft);
}
.banner h3 {
  margin: 3px 0 4px;
  font-size: 15px;
}
.banner.fail h3 {
  color: var(--red);
}
.banner.stale h3 {
  color: #8a6212;
}
.b-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-soft);
}
.b-time {
  color: var(--jade);
}
.confirm {
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 16px;
  border-radius: 8px;
  border: 1px solid var(--jade);
  background: var(--jade);
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
}
.confirm:disabled {
  background: #c9c4bc;
  border-color: #c9c4bc;
  cursor: not-allowed;
}

.confirm-link {
  font-size: 13px;
  font-weight: 600;
  padding: 9px 16px;
  border-radius: 8px;
  border: 1px solid var(--red);
  color: var(--red);
  background: #fff;
  white-space: nowrap;
}
.confirm-link:hover {
  background: var(--red);
  color: #fff;
}

.modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 12px 16px;
}
.mode {
  text-align: left;
  font: inherit;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mode b {
  font-size: 13px;
}
.mode span {
  font-size: 11.5px;
  color: var(--ink-soft);
}
.mode.on {
  border-color: var(--red);
  background: #fbeee8;
  box-shadow: inset 0 0 0 1px var(--red);
}

.blocked,
.assign,
.ledger,
.grades,
.voidbox {
  padding: 12px 16px;
  border-top: 1px solid var(--line);
}
h4 {
  margin: 4px 0 8px;
  font-size: 13.5px;
}
h4.mt {
  margin-top: 14px;
}
.fail-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fail-item {
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
  background: var(--surface-2);
  border: 1px solid #f0cfc9;
  border-radius: 7px;
  padding: 7px 10px;
  font-size: 12.5px;
}
.reason {
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: #fff;
}
.reason.span {
  background: #b3541e;
}
.reason.weight {
  background: var(--red);
}
.reason.bend {
  background: #7a2f8f;
}
.where {
  font-weight: 600;
}
.detail {
  color: var(--ink-soft);
  flex-basis: 100%;
  font-size: 12px;
}

.remedies {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.remedy {
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  padding: 10px 12px;
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.remedy.dead {
  opacity: 0.62;
}
.remedy header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.tag {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  font-family: var(--mono);
}
.tag.yes {
  background: #dff0e6;
  color: var(--jade);
}
.tag.no {
  background: #f6ddd9;
  color: var(--red);
}
.cost {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
}
.cost label {
  color: var(--ink);
  font-weight: 600;
}
.cannot {
  margin: 0;
  font-size: 12px;
  color: #7a2f8f;
}
.cannot.both {
  margin-top: 8px;
  padding: 7px 10px;
  background: #f6eff8;
  border: 1px solid #d9c2e0;
  border-radius: 7px;
  color: #6a2578;
}
.remedy button {
  margin-top: auto;
  font: inherit;
  font-size: 12.5px;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid var(--red);
  background: #fff;
  color: var(--red);
  cursor: pointer;
}
.remedy button:hover:not(:disabled) {
  background: var(--red);
  color: #fff;
}
.remedy button:disabled {
  border-color: #c9c4bc;
  color: #a89a89;
  cursor: not-allowed;
}

.abandoned {
  margin: 0;
  padding: 9px 16px;
  font-size: 12px;
  color: #8a6212;
  background: #fbf4e2;
  border-top: 1px solid var(--line);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th {
  text-align: left;
  padding: 5px 8px;
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 11px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
td {
  padding: 5px 8px;
  border-bottom: 1px dashed var(--line);
}
tfoot td {
  border-bottom: none;
  font-size: 11.5px;
  color: var(--ink-soft);
}
.num {
  text-align: right;
}
.mono {
  font-family: var(--mono);
}
.strong {
  font-weight: 700;
}
td.bad {
  color: var(--red);
  font-weight: 700;
}
td.warn {
  color: #b3541e;
  font-weight: 600;
}
td.ok {
  color: var(--jade);
}
tr.zero td {
  color: #b8ac9c;
}
select {
  font: inherit;
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: #fff;
}
.sw {
  display: inline-block;
  width: 34px;
  min-height: 3px;
  border-radius: 2px;
  vertical-align: middle;
}

.voidbox {
  background: #fdf1ef;
}
.voidbox ul {
  margin: 0 0 8px;
  padding-left: 18px;
  font-size: 12px;
  color: var(--ink-soft);
}
.redo {
  margin: 0;
  font-size: 12.5px;
  color: var(--red);
}
.redo.small {
  padding: 8px 16px;
  margin: 0;
  border-top: 1px solid var(--line);
}
.exports-ok {
  margin: 0;
  padding: 8px 16px;
  font-size: 12px;
  color: var(--jade);
  border-top: 1px solid var(--line);
}

.compact .modes,
.compact .assign,
.compact .ledger,
.compact .grades,
.compact .voidbox {
  display: none;
}
</style>
