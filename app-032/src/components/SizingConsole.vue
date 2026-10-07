<script setup lang="ts">
/**
 * 竹篾规格选型核定面板
 * - 判定方式二选一：全灯统一一档 / 逐层各选一档（代价写清，切换即作废旧版）
 * - 撑不住当场拦住：写明跨度太长 / 重量太大 / 弯得太急
 * - 两条路：换粗一档 / 多添一道横篾圈，代价并列，用户自己取舍
 * - 核定通过才能存档；存档后改参数全部重算并列出四处变更
 */
import { computed } from 'vue'
import type { Lantern } from '../core/types'
import { BAMBOO } from '../core/craft'
import {
  acceptSizing,
  applyRemedy,
  currentSizing,
  setLayerCourses,
  setLayerGrade,
  setSizingMode,
  setUniformGrade
} from '../core/store'
import type { FailureKind, LayerSizingEvaluation, SizingResult } from '../core/sizing'

const props = defineProps<{ lantern: Lantern; sizing: SizingResult; compact?: boolean }>()

const st = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return props.lantern.sizing!
})

const accepted = computed(() => props.lantern.sizing?.accepted ?? null)

const FAIL_WORD: Record<FailureKind, string> = {
  span: '跨度太长',
  weight: '重量太大',
  bend: '弯得太急'
}

function pct(u: number): string {
  return (u * 100).toFixed(0) + '%'
}

function chooseMode(m: 'uniform' | 'byLayer') {
  if (st.value.mode === m) return
  if (accepted.value) {
    if (!window.confirm('切换判定方式会把当前已核定结论、本机灯样存档与已导出的备料单全部作废重来，按旧规格已裁刨的篾要退回重新定规格。确认切换？'))
      return
  }
  setSizingMode(props.lantern, m)
}

function onUniformGrade(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  setUniformGrade(props.lantern, v === '__auto__' ? null : v)
}

function onLayerGrade(i: number, e: Event) {
  const v = (e.target as HTMLSelectElement).value
  setLayerGrade(props.lantern, i, v === '__auto__' ? null : v)
}

function onCourses(i: number, e: Event) {
  setLayerCourses(props.lantern, i, Number((e.target as HTMLInputElement).value))
}

function takeRemedy(i: number, path: 'grade' | 'courses') {
  const r = currentSizing(props.lantern)
  const opt = r.layers[i]?.blocked?.remedies.find((x) => x.path === path)
  if (!opt) return
  if (!opt.viable) {
    window.alert(`这条路走不通：${opt.cost}`)
    return
  }
  if (accepted.value) {
    if (!window.confirm('应用补救路会作废已存档结论与已导出备料单，按旧规格已裁刨的篾退回重新定规格。确认？')) return
  }
  applyRemedy(props.lantern, i, opt)
}

function doAccept() {
  const res = acceptSizing(props.lantern)
  if (!res.ok) window.alert(res.error || '当前规格撑不住，不能核定。')
}

function ledgerKindWord(k: string): string {
  return k === 'accept' ? '核定' : k === 'void-param' ? '参数变更作废' : k === 'void-mode' ? '改判作废' : '补救处置'
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function maxUtil(e: LayerSizingEvaluation): number {
  return Math.max(e.check.strengthUtil, e.check.deflectionUtil, e.check.formingUtil)
}
</script>

<template>
  <section class="sizing" :class="{ fail: !sizing.passed, compact }">
    <header class="sz-head">
      <h3>竹篾规格选型核定</h3>
      <span class="verdict" :class="sizing.passed ? 'ok' : 'no'">
        {{ sizing.passed ? (accepted ? '已核定 v' + accepted.version : '计算通过 · 待核定') : `${sizing.blockedCount} 层撑不住 · 已拦住` }}
      </span>
    </header>

    <!-- 判定方式二选一 -->
    <div class="modes">
      <button class="mode" :class="{ on: st.mode === 'uniform' }" @click="chooseMode('uniform')">
        <b>全灯统一选一档</b>
        <small>按最不利的那一层定规格；备料简单、加工省事</small>
        <em class="price">代价：上层更重、上口更难弯</em>
      </button>
      <button class="mode" :class="{ on: st.mode === 'byLayer' }" @click="chooseMode('byLayer')">
        <b>逐层各选一档</b>
        <small>每层按自己受力选；省料省重</small>
        <em class="price">代价：规格变多、加工要一层层分清</em>
      </button>
    </div>
    <p class="tradeoff">{{ sizing.modeTradeoff }}</p>

    <!-- 重量总账（逐层合计与总重一致，CHK-10） -->
    <div class="mass">
      <div class="m"><span>竹篾骨架</span><b>{{ sizing.mass.bambooG.toFixed(1) }} g</b></div>
      <div class="m"><span>蒙面</span><b>{{ sizing.mass.coveringG.toFixed(1) }} g</b></div>
      <div class="m"><span>扎线</span><b>{{ sizing.mass.lashG.toFixed(1) }} g</b></div>
      <div class="m"><span>LED 含线</span><b>{{ sizing.mass.ledG.toFixed(1) }} g</b></div>
      <div class="m total"><span>灯体总重</span><b>{{ sizing.mass.totalG.toFixed(1) }} g / {{ (sizing.mass.totalG / 1000).toFixed(3) }} kg</b></div>
    </div>

    <!-- 统一模式档选择 -->
    <div v-if="st.mode === 'uniform'" class="uni-row">
      <label>全灯统一档</label>
      <select :value="st.uniformGradeId || '__auto__'" @change="onUniformGrade">
        <option value="__auto__">自动（按最不利层：{{ sizing.grades[Math.max(...sizing.choice.layerGradeIds.map((id) => BAMBOO.grades.findIndex((g) => g.id === id)))]?.name }}）</option>
        <option v-for="g in sizing.grades" :key="g.id" :value="g.id">
          {{ g.name }} {{ g.widthMm.toFixed(1) }}×{{ g.thicknessMm.toFixed(1) }}mm
        </option>
      </select>
      <span class="hint">竖篾 = <b>{{ sizing.verticalGrade.name }} {{ sizing.verticalGrade.widthMm.toFixed(1) }}×{{ sizing.verticalGrade.thicknessMm.toFixed(1) }}mm</b></span>
    </div>

    <!-- 逐层核定表 -->
    <table class="layers">
      <thead>
        <tr>
          <th>层</th>
          <th class="num">层高/直径 (mm)</th>
          <th class="num">上口收进 (mm)</th>
          <th class="num">竖篾跨度 (mm)</th>
          <th>横篾档 / 道数</th>
          <th class="num">该层承重 (g)</th>
          <th class="num">应力/挠度/弯形</th>
          <th>判定</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in sizing.layers" :key="e.layerIndex" :class="{ blocked: e.blocked }">
          <td class="ly">第 {{ e.layerIndex + 1 }} 层</td>
          <td class="num mono">{{ e.heightMm.toFixed(1) }} / ⌀{{ e.diameterMm.toFixed(1) }}</td>
          <td class="num mono">{{ e.tuckMm.toFixed(1) }}</td>
          <td class="num mono">{{ e.ribSpanMm.toFixed(1) }}</td>
          <td>
            <select
              v-if="st.mode === 'byLayer'"
              :value="st.gradeOverrides?.[e.layerIndex] || '__auto__'"
              @change="onLayerGrade(e.layerIndex, $event)"
            >
              <option value="__auto__">自动（{{ e.ringGrade.name }}）</option>
              <option v-for="g in sizing.grades" :key="g.id" :value="g.id">
                {{ g.name }} {{ g.widthMm.toFixed(1) }}×{{ g.thicknessMm.toFixed(1) }}mm
              </option>
            </select>
            <b v-else>{{ e.ringGrade.name }} {{ e.ringGrade.widthMm.toFixed(1) }}×{{ e.ringGrade.thicknessMm.toFixed(1) }}mm</b>
            <div class="courses">
              {{ e.totalCourses }} 道
              <input
                type="number"
                min="0"
                max="6"
                style="width: 56px"
                :value="st.courseOverrides?.[e.layerIndex] ?? e.totalCourses - 2"
                @change="onCourses(e.layerIndex, $event)"
              />
              <small>内部加圈</small>
            </div>
          </td>
          <td class="num mono">{{ e.layerMassG.toFixed(1) }}</td>
          <td class="num mono util">
            <span :class="{ over: e.ring.strengthUtil > 1 }">强 {{ pct(Math.max(e.ring.strengthUtil, e.rib.strengthUtil)) }}</span>
            <span :class="{ over: Math.max(e.ring.deflectionUtil, e.rib.deflectionUtil) > 1 }">挠 {{ pct(Math.max(e.ring.deflectionUtil, e.rib.deflectionUtil)) }}</span>
            <span :class="{ over: Math.max(e.ring.formingUtil, e.rib.formingUtil) > 1 }">弯 {{ pct(Math.max(e.ring.formingUtil, e.rib.formingUtil)) }}</span>
          </td>
          <td>
            <span v-if="!e.blocked" class="pass">撑得住（{{ pct(maxUtil(e)) }}）</span>
            <span v-else class="failword">⚠ {{ FAIL_WORD[e.blocked.kind] }}</span>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 拦住卡片：原因 + 两条路 -->
    <template v-for="e in sizing.layers.filter((x) => x.blocked)" :key="'blk' + e.layerIndex">
      <div class="block" v-if="e.blocked">
        <div class="blk-title">
          ⛔ 第 {{ e.layerIndex + 1}} 层被拦住：<b>{{ FAIL_WORD[e.blocked.kind] }}</b>
        </div>
        <p class="blk-reason">{{ e.blocked.reason }}</p>
        <div class="remedies">
          <div v-for="r in e.blocked.remedies" :key="r.path" class="remedy" :class="{ dead: !r.viable }">
            <div class="r-head">
              <b>{{ r.path === 'grade' ? '路 ① 换粗一档' : '路 ② 多添一道横篾圈' }}</b>
              <span class="r-title">{{ r.title }}</span>
            </div>
            <p class="r-cost">{{ r.cost }}</p>
            <button :disabled="!r.viable" @click="takeRemedy(e.layerIndex, r.path)">
              {{ r.viable ? '走这条（' + (r.path === 'grade' ? '换粗' : '加圈') + '）' : '此路不通' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 最不利层细账 -->
    <details class="detail" v-if="!compact">
      <summary>受力估算细账（净长/跨度/弯半径均取自既有轮廓与周长，未在选型里重新量）</summary>
      <div v-for="e in sizing.layers" :key="'d' + e.layerIndex" class="dlayer">
        <h4>第 {{ e.layerIndex + 1 }} 层</h4>
        <p class="fl">
          横篾最不利圈（高 {{ e.ring.yMm.toFixed(1) }}mm、R{{ e.ring.radiusMm.toFixed(1) }}）：支点跨度
          {{ e.ring.spanMm.toFixed(1) }}mm，线荷载 {{ e.ring.lineLoadGPerMm.toFixed(4) }}g/mm，
          M={{ e.ring.bendMomentNmm.toFixed(2) }}N·mm，需要截面模量 {{ e.ring.demandSectionModulusMm3.toFixed(1) }}mm³，
          选定档实有 {{ e.ring.actualSectionModulusMm3.toFixed(1) }}mm³；挠度 {{ e.ring.deflectionMm.toFixed(2) }}mm / 限
          {{ e.ring.deflectionLimitMm.toFixed(2) }}mm；冷弯厚限 {{ e.ring.formingMaxThicknessMm.toFixed(1) }}mm。
        </p>
        <p class="fl">
          竖篾该层跨度 {{ e.rib.spanMm.toFixed(1) }}mm，线荷载 {{ e.rib.lineLoadGPerMm.toFixed(4) }}g/mm，
          M={{ e.rib.bendMomentNmm.toFixed(2) }}N·mm；挠度 {{ e.rib.deflectionMm.toFixed(2) }}mm / 限
          {{ e.rib.deflectionLimitMm.toFixed(2) }}mm；
          {{ e.rib.formingR == null ? '平口直段不需弯。' : `收口肩部 R${e.rib.formingR!.toFixed(1)}mm，冷弯厚限 ${e.rib.formingMaxThicknessMm!.toFixed(1)}mm。` }}
        </p>
      </div>
      <p class="units">单位与精度：截面 mm（1 位小数）；长度 mm（1 位）/ m（3 位）；重量 g（1 位）与 kg（3 位）；力按 g=9.80665m/s² 换算 N。</p>
    </details>

    <!-- 核定按钮 -->
    <div class="actions">
      <button class="primary" :disabled="!sizing.passed" @click="doAccept">
        {{ sizing.passed ? '核定此规格并存档（四处按此同一组数下料）' : '撑不住，不能核定——先在上方选一条补救路' }}
      </button>
      <span v-if="sizing.overridesNote" class="ov-note">{{ sizing.overridesNote }}</span>
    </div>

    <!-- 台账 -->
    <details class="ledger" v-if="st.ledger && st.ledger.length">
      <summary>作废 / 处置台账（{{ st.ledger.length }} 条）</summary>
      <ul>
        <li v-for="e in st.ledger" :key="e.id">
          <span class="lg-tag">{{ ledgerKindWord(e.kind) }}</span>
          <span class="lg-time">{{ fmtTime(e.at) }}</span>
          <div class="lg-reason"><b>{{ e.reason }}</b>：{{ e.detail }}</div>
          <div v-if="e.givenUp" class="lg-given">被放弃的路：{{ e.givenUp }}</div>
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.sizing {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sizing.fail {
  border-color: #e3a6a0;
}
.sz-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.sz-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--ink);
}
.verdict {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  font-family: var(--mono);
}
.verdict.ok {
  background: #e3f1ea;
  color: var(--jade);
  border: 1px solid #cbe3d8;
}
.verdict.no {
  background: #fadbd6;
  color: var(--red);
  border: 1px solid #f2c7c1;
}
.modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.mode {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--surface-2);
  line-height: 1.4;
}
.mode b {
  font-size: 13px;
}
.mode small {
  font-size: 11.5px;
}
.mode .price {
  font-style: normal;
  font-size: 11px;
  color: #8a4b12;
}
.mode.on {
  border-color: var(--red);
  background: #fdf2f0;
  box-shadow: inset 0 0 0 1px var(--red);
}
.tradeoff {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink-soft);
  background: var(--surface-2);
  border-radius: 6px;
  padding: 7px 10px;
}
.mass {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.m {
  background: var(--surface);
  padding: 7px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m span {
  font-size: 10.5px;
  color: var(--ink-soft);
}
.m b {
  font-family: var(--mono);
  font-size: 12.5px;
}
.m.total b {
  color: #8f1c19;
}
.uni-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  flex-wrap: wrap;
}
.uni-row select {
  width: auto;
  padding: 4px 8px;
}
.uni-row .hint {
  font-size: 11.5px;
  color: var(--ink-soft);
}
table.layers {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
table.layers th {
  text-align: left;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--ink-soft);
  font-weight: 500;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
table.layers td {
  padding: 6px 8px;
  border-bottom: 1px dashed var(--line);
  vertical-align: middle;
}
tr.blocked {
  background: #fdf1ef;
}
.num {
  text-align: right;
}
.mono {
  font-family: var(--mono);
}
.ly {
  font-weight: 600;
  white-space: nowrap;
}
.courses {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-soft);
}
.courses input {
  width: 56px;
  padding: 2px 5px;
}
.util {
  white-space: nowrap;
}
.util span {
  display: inline-block;
  margin-left: 4px;
}
.util .over {
  color: var(--red);
  font-weight: 700;
}
.pass {
  color: var(--jade);
  font-size: 11.5px;
}
.failword {
  color: var(--red);
  font-weight: 700;
  font-size: 11.5px;
}
.block {
  border: 1px solid #e3a6a0;
  background: #fdf5f4;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.blk-title {
  font-size: 13px;
  color: #8f1c19;
}
.blk-reason {
  margin: 0;
  font-size: 12px;
  color: #6a3a35;
}
.remedies {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.remedy {
  background: #fff;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.remedy.dead {
  opacity: 0.62;
  background: #f6f2ec;
}
.r-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.r-title {
  font-size: 12px;
  color: #8f1c19;
}
.r-cost {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink-soft);
  line-height: 1.55;
}
.remedy button {
  align-self: flex-start;
  padding: 4px 12px;
}
.remedy button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.detail,
.ledger {
  font-size: 12px;
  background: var(--surface-2);
  border-radius: 8px;
  padding: 8px 12px;
}
.detail summary,
.ledger summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 12.5px;
}
.dlayer {
  margin-top: 8px;
}
.dlayer h4 {
  margin: 6px 0 2px;
  font-size: 12px;
}
.fl {
  margin: 2px 0;
  color: var(--ink-soft);
  line-height: 1.6;
}
.units {
  color: #8a7a68;
  font-size: 11px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.actions .primary {
  background: var(--red);
  color: #fff;
  border-color: var(--red);
  font-weight: 600;
  padding: 7px 16px;
}
.actions .primary:disabled {
  background: #c9b9b4;
  border-color: #c9b9b4;
  cursor: not-allowed;
}
.ov-note {
  font-size: 11.5px;
  color: #8a4b12;
}
.ledger ul {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ledger li {
  border-left: 3px solid var(--red);
  padding-left: 8px;
}
.lg-tag {
  font-size: 10.5px;
  background: #fdecea;
  color: var(--red);
  border-radius: 4px;
  padding: 1px 6px;
  margin-right: 6px;
}
.lg-time {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--ink-soft);
}
.lg-reason {
  font-size: 11.5px;
  margin-top: 2px;
  line-height: 1.55;
}
.lg-given {
  font-size: 11px;
  color: #8a4b12;
  margin-top: 2px;
}
@media (max-width: 900px) {
  .modes,
  .remedies,
  .mass {
    grid-template-columns: 1fr;
  }
}
</style>
