<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChecksPanel from '../components/ChecksPanel.vue'
import SizingChangeReport from '../components/SizingChangeReport.vue'
import { getLantern } from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { downloadText, materialsCsv } from '../core/exporter'
import { coveringSpec, CRAFT } from '../core/craft'
import { panelCutArea } from '../core/panels'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))
const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
})

const cov = computed(() => (lantern.value ? coveringSpec(lantern.value.covering) : null))
const exportLocked = computed(() => !lantern.value?.sizing?.accepted || !full.value?.sizing.passed)

const layerFabric = computed(() => {
  const l = lantern.value
  if (!l || !full.value) return []
  return l.layers.map((ly, i) => {
    const ps = full.value!.panels.panels.filter((p) => p.layerIndex === i)
    const area = ps.reduce((s, p) => s + panelCutArea(p) * p.qty, 0)
    return {
      i: i + 1,
      color: l.layerColors[i] || l.color,
      height: ly.heightMm,
      diameter: ly.diameterMm,
      kinds: ps.length,
      perPiece: ps.length ? panelCutArea(ps[0]) : 0,
      qty: ps.reduce((s, p) => s + p.qty, 0),
      areaM2: area / 1e6,
      layerMassG: full.value!.sizing.mass.layerMassG[i] || 0,
      courses: full.value!.sizing.choice.totalCourses[i],
      gradeName: full.value!.sizing.layerGrades[i]?.name || '',
      gradeW: full.value!.sizing.layerGrades[i]?.widthMm || 0,
      gradeT: full.value!.sizing.layerGrades[i]?.thicknessMm || 0
    }
  })
})

function exportCsv() {
  const l = lantern.value
  if (!l || !full.value) return
  if (exportLocked.value) {
    window.alert('当前选型尚未核定通过（或旧版结论已作废）：备料单不能作为下料依据，请先回到「骨架件表」页核定规格。')
    return
  }
  downloadText(`${l.name}-备料单.csv`, materialsCsv(l, full.value.materials, full.value.batch))
}
</script>

<template>
  <div v-if="!lantern || !full || !cov" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="materials">
    <section class="head">
      <div>
        <h2>材料统计与备料单 · {{ lantern.name }}</h2>
        <p class="sub">
          竹篾按<b>含绑扎余量</b>长度备料；蒙面按<b>含缝份</b>的裁片面积备料；
          批量总量 = 单灯 × 数量 × (1 + 损耗率)。
        </p>
      </div>
      <div class="ops">
        <button @click="exportCsv" :class="{ locked: exportLocked }">导出备料单 CSV</button>
        <button class="primary" @click="router.push(`/print/${lantern.id}?view=frame`)">打印备料 / 清单</button>
      </div>
    </section>

    <p v-if="exportLocked" class="lock-banner">
      ⛔ 当前选型未核定通过或已被参数改动作废：备料统计仅供参考，导出已拦住。核定通过后才能按此备料下料。
    </p>

    <SizingChangeReport v-if="full" :lantern="lantern" :diff="full.sizingDiff" scope="materials" />

    <section class="mass-bar">
      <div class="mb"><span>竹篾骨架</span><b>{{ full.materials.bambooMassG.toFixed(1) }} g</b></div>
      <div class="mb"><span>蒙面（{{ cov.name }} {{ cov.massPerM2 }}g/m²）</span><b>{{ full.materials.coveringMassG.toFixed(1) }} g</b></div>
      <div class="mb"><span>扎线</span><b>{{ full.materials.lashMassG.toFixed(1) }} g</b></div>
      <div class="mb"><span>LED 含线</span><b>{{ full.materials.ledMassG.toFixed(1) }} g</b></div>
      <div class="mb total"><span>灯体总重</span><b>{{ full.materials.totalMassG.toFixed(1) }} g ＝ {{ (full.materials.totalMassG / 1000).toFixed(3) }} kg</b></div>
      <div class="mb force"><span>总重力</span><b>{{ ((full.materials.totalMassG * 9.80665) / 1000).toFixed(2) }} N</b></div>
    </section>

    <section class="batch">
      <div class="field">
        <label>批量数量（个）</label>
        <input v-model.number="lantern.batchCount" type="number" min="1" max="500" step="1" />
      </div>
      <div class="field">
        <label>损耗率 <em>{{ (lantern.wasteRatio * 100).toFixed(0) }}%</em></label>
        <input v-model.number="lantern.wasteRatio" type="range" min="0" max="0.2" step="0.01" />
      </div>
      <p class="formula mono">
        批量 = 单灯 × {{ Math.max(1, Math.round(lantern.batchCount)) }} × {{ (1 + lantern.wasteRatio).toFixed(2) }}
      </p>
    </section>

    <section class="tables">
      <table class="tally">
        <thead>
          <tr>
            <th>项目</th>
            <th class="num">单灯</th>
            <th class="num">批量 {{ full.batch.count }} 个（含损耗）</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>竹篾 / 铁丝（含绑扎余量）</td>
            <td class="num mono">{{ full.materials.frameM.toFixed(3) }} m</td>
            <td class="num mono strong">{{ full.batch.frameM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>构件净长合计</td>
            <td class="num mono">{{ full.materials.frameRawM.toFixed(3) }} m</td>
            <td class="num mono">{{ full.batch.frameRawM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>蒙面 {{ cov.name }}（含缝份）</td>
            <td class="num mono">{{ full.materials.coveringM2.toFixed(3) }} m²</td>
            <td class="num mono strong">{{ full.batch.coveringM2.toFixed(3) }} m²</td>
          </tr>
          <tr>
            <td>蒙面净面积（不含缝份）</td>
            <td class="num mono">{{ full.materials.coveringNetM2.toFixed(3) }} m²</td>
            <td class="num mono">{{ full.batch.coveringNetM2.toFixed(3) }} m²</td>
          </tr>
          <tr>
            <td>扎线（{{ full.materials.lashJoints }} 处绑扎 × {{ CRAFT.lashPerJointM }}m/处）</td>
            <td class="num mono">{{ full.materials.lashM.toFixed(3) }} m</td>
            <td class="num mono">{{ full.batch.lashM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>胶（{{ cov.name }} {{ cov.gluePerM2 }}g/m²）</td>
            <td class="num mono">{{ full.materials.glueG.toFixed(1) }} g</td>
            <td class="num mono">{{ full.batch.glueG.toFixed(1) }} g</td>
          </tr>
          <tr class="led">
            <td>LED 灯珠建议</td>
            <td class="num mono">{{ full.materials.ledCount }} 颗</td>
            <td class="num mono">{{ full.batch.ledCount }} 颗</td>
          </tr>
        </tbody>
      </table>

      <div class="side">
        <div class="stat"><span>灯体体积</span><b>{{ full.materials.volumeL.toFixed(3) }} L</b></div>
        <div class="stat"><span>灯体表面积</span><b>{{ full.materials.surfaceM2.toFixed(3) }} m²</b></div>
        <div class="stat"><span>构件总根数</span><b>{{ full.frame.totalQty }}</b></div>
        <div class="stat"><span>裁片总块数</span><b>{{ full.panels.totalQty }}</b></div>
        <p class="rule">LED 建议规则：{{ CRAFT.led.rule }}</p>
      </div>
    </section>

    <section class="grades">
      <h3>竹篾按选型截面分档备料（每根篾截取长度 × 数量，与构件表同一组数）</h3>
      <table>
        <thead>
          <tr>
            <th>档名</th>
            <th class="num">截面宽×厚 (mm)</th>
            <th class="num">单灯截取总长 (m)</th>
            <th class="num">单灯竹重 (g)</th>
            <th class="num">批量截取总长 (m)</th>
            <th class="num">批量竹重 (g)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in full.materials.byGrade" :key="g.gradeId">
            <td>{{ g.gradeName }}</td>
            <td class="num mono">{{ g.widthMm.toFixed(1) }}×{{ g.thicknessMm.toFixed(1) }}</td>
            <td class="num mono">{{ g.stockM.toFixed(3) }}</td>
            <td class="num mono">{{ g.massG.toFixed(1) }}</td>
            <td class="num mono strong">{{ (g.stockM * full.batch.count * (1 + full.batch.wasteRatio)).toFixed(3) }}</td>
            <td class="num mono strong">{{ (g.massG * full.batch.count * (1 + full.batch.wasteRatio)).toFixed(1) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="palette">
      <h3>分层蒙面用量（按层买布/买纸用）</h3>
      <table>
        <thead>
          <tr>
            <th>层</th>
            <th>颜色</th>
            <th class="num">分段高 (mm)</th>
            <th class="num">该层直径 (mm)</th>
            <th class="num">横篾档/道数</th>
            <th class="num">裁片种类</th>
            <th class="num">每块面积 (m²)</th>
            <th class="num">块数</th>
            <th class="num">合计面积 (m²)</th>
            <th class="num">该层承重 (g)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in layerFabric" :key="r.i">
            <td class="mono">第 {{ r.i }} 层</td>
            <td>
              <span class="dot" :style="{ background: r.color }" />
              <span class="mono">{{ r.color }}</span>
            </td>
            <td class="num mono">{{ r.height.toFixed(1) }}</td>
            <td class="num mono">{{ r.diameter.toFixed(1) }}</td>
            <td class="num mono">{{ r.gradeName }} {{ r.gradeW.toFixed(1) }}×{{ r.gradeT.toFixed(1) }} / {{ r.courses }} 道</td>
            <td class="num mono">{{ r.kinds }}</td>
            <td class="num mono">{{ (r.perPiece / 1e6).toFixed(4) }}</td>
            <td class="num mono">{{ r.qty }}</td>
            <td class="num mono">{{ r.areaM2.toFixed(3) }}</td>
            <td class="num mono strong">{{ r.layerMassG.toFixed(1) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <ChecksPanel :checks="full.checks" :elapsed-ms="full.elapsedMs" title="全量验收自检（§10）" />
  </div>
</template>

<style scoped>
.materials {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
}

h2 {
  margin: 0 0 6px;
  font-size: 18px;
  color: #8f1c19;
  border-left: 4px solid var(--red);
  padding-left: 10px;
}

.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-soft);
  max-width: 900px;
}

.ops {
  display: flex;
  gap: 8px;
}

button {
  font: inherit;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  padding: 6px 12px;
  font-size: 12.5px;
}

button:hover {
  border-color: var(--red);
  color: var(--red);
}

button.primary {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  font-weight: 600;
}

button.primary:hover {
  background: #9c1f1b;
  color: #fff;
}

.batch {
  display: flex;
  gap: 24px;
  align-items: flex-end;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: var(--shadow);
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}

label {
  font-size: 12px;
  color: var(--ink-soft);
}

label em {
  font-style: normal;
  font-family: var(--mono);
  color: var(--blue);
}

input[type='number'] {
  font: inherit;
  font-size: 13px;
  padding: 5px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  width: 120px;
  font-family: var(--mono);
}

input[type='range'] {
  width: 180px;
  accent-color: var(--red);
}

.formula {
  margin: 0 0 4px auto;
  font-size: 13px;
  color: #8f1c19;
  background: #fbeae6;
  padding: 5px 12px;
  border-radius: 6px;
}

.tables {
  display: grid;
  grid-template-columns: 1fr minmax(240px, 300px);
  gap: 16px;
  align-items: start;
}

@media (max-width: 900px) {
  .tables {
    grid-template-columns: 1fr;
  }
}

.tally,
.palette table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  box-shadow: var(--shadow);
}

.tally th,
.palette th {
  text-align: left;
  padding: 8px 14px;
  background: var(--surface-2);
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 11.5px;
  border-bottom: 1px solid var(--line);
}

.tally td,
.palette td {
  padding: 8px 14px;
  border-bottom: 1px dashed var(--line);
}

.tally tr:last-child td,
.palette tr:last-child td {
  border-bottom: none;
}

tr.led td {
  background: #fff9ec;
}

.num {
  text-align: right;
}

.mono {
  font-family: var(--mono);
}

.strong {
  font-weight: 700;
  color: #8f1c19;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}

.stat {
  background: var(--surface);
  padding: 9px 14px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.stat span {
  font-size: 11.5px;
  color: var(--ink-soft);
}

.stat b {
  font-family: var(--mono);
  font-size: 14px;
}

.rule {
  margin: 0;
  background: var(--surface);
  padding: 10px 14px;
  font-size: 11.5px;
  color: var(--ink-soft);
}

.lock-banner {
  margin: 0;
  padding: 9px 12px;
  font-size: 12.5px;
  color: #8f1c19;
  background: #fdecea;
  border: 1px solid #e3a6a0;
  border-radius: 8px;
}

button.locked {
  border-style: dashed;
  color: #a85a52;
}

.mass-bar {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}

.mb {
  background: var(--surface);
  padding: 10px 13px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.mb span {
  font-size: 11px;
  color: var(--ink-soft);
}

.mb b {
  font-family: var(--mono);
  font-size: 13.5px;
}

.mb.total b {
  color: #8f1c19;
}

.mb.force b {
  color: var(--blue);
}

.grades {
  box-shadow: var(--shadow);
  border-radius: 10px;
}

.grades h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.grades table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  box-shadow: var(--shadow);
}

.grades th {
  text-align: left;
  padding: 8px 14px;
  background: var(--surface-2);
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 11.5px;
  border-bottom: 1px solid var(--line);
}

.grades td {
  padding: 8px 14px;
  border-bottom: 1px dashed var(--line);
}

.grades tr:last-child td {
  border-bottom: none;
}

.palette {
  box-shadow: var(--shadow);
  border-radius: 10px;
}

.palette h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 3px;
  margin-right: 5px;
  border: 1px solid var(--line-strong);
}

.missing {
  padding: 40px;
  text-align: center;
}
</style>
