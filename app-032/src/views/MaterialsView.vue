<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChecksPanel from '../components/ChecksPanel.vue'
import { getLantern } from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { downloadText, materialsCsv } from '../core/exporter'
import { recordExport } from '../core/selection'
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
const sel = computed(() => full.value?.selection ?? null)

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
      loadG: full.value!.materials.bandLedger[i]?.subtotalG ?? 0
    }
  })
})

function exportCsv() {
  const l = lantern.value
  if (!l || !full.value) return
  const filename = `${l.name}-备料单-R${l.selection.revision}.csv`
  const gate = recordExport(l, 'materials', filename)
  if (!gate.ok) {
    window.alert(gate.error)
    return
  }
  downloadText(filename, materialsCsv(l, full.value.materials, full.value.batch))
}
</script>

<template>
  <div v-if="!lantern || !full || !cov || !sel" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="materials">
    <section v-if="!sel.pass || sel.stale" class="gate-warn">
      <strong>备料单暂不能导出：</strong>
      <template v-if="!sel.pass">选型核定未通过（撑不住），先到「骨架件表」页按两条可走的办法选定规格；</template>
      <template v-else>灯样参数已改动，选型结论尚未按新版重算确认，旧版备料单已作废；</template>
      <router-link :to="`/frame/${lantern.id}`">去核定选型 →</router-link>
    </section>

    <section class="head">
      <div>
        <h2>材料统计与备料单 · {{ lantern.name }} <span class="rev">选型 R{{ lantern.selection.revision }}</span></h2>
        <p class="sub">
          竹篾按<b>含绑扎余量</b>长度、按<b>选型核定的宽厚与道数</b>备料；蒙面按<b>含缝份</b>的裁片面积备料；
          批量总量 = 单灯 × 数量 × (1 + 损耗率)。改直径或换蒙面后须重新确认选型，旧备料单自动作废。
        </p>
      </div>
      <div class="ops">
        <button :disabled="!sel.pass || sel.stale" @click="exportCsv">导出备料单 CSV</button>
        <button class="primary" @click="router.push(`/print/${lantern.id}?view=frame`)">打印备料 / 清单</button>
      </div>
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

    <section class="palette">
      <h3>分规格竹篾用料（与构件表同一份选型结论）</h3>
      <table>
        <thead>
          <tr>
            <th>规格档</th>
            <th class="num">宽×厚 (mm)</th>
            <th class="num">单灯根数</th>
            <th class="num">单灯截取总长 (m)</th>
            <th class="num">单灯重 (g)</th>
            <th class="num">批量 {{ full.batch.count }} 个总长 (m)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="gl in full.materials.gradeLengths.filter((x) => x.lengthMm > 0)" :key="gl.grade.id">
            <td>{{ gl.grade.id }} {{ gl.grade.name }}</td>
            <td class="num mono">{{ gl.grade.widthMm.toFixed(1) }}×{{ gl.grade.thicknessMm.toFixed(1) }}</td>
            <td class="num mono">{{ gl.qty }}</td>
            <td class="num mono strong">{{ (gl.lengthMm / 1000).toFixed(3) }}</td>
            <td class="num mono">{{ gl.massG.toFixed(1) }}</td>
            <td class="num mono">{{ ((gl.lengthMm / 1000) * full.batch.count * (1 + lantern.wasteRatio)).toFixed(3) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="palette">
      <h3>重量账（g / kg / N；逐层合计与总重严格一致，CHK-11）</h3>
      <table>
        <thead>
          <tr>
            <th>项目</th>
            <th class="num">单灯 (g)</th>
            <th class="num">单灯 (kg)</th>
            <th class="num">批量 {{ full.batch.count }} 个 (g)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>竹篾骨架自重（按选定宽厚）</td>
            <td class="num mono">{{ full.materials.frameMassG.toFixed(1) }}</td>
            <td class="num mono">{{ (full.materials.frameMassG / 1000).toFixed(3) }}</td>
            <td class="num mono">{{ full.batch.frameMassG.toFixed(1) }}</td>
          </tr>
          <tr>
            <td>蒙面材料重（含缝份）</td>
            <td class="num mono">{{ full.materials.coveringMassG.toFixed(1) }}</td>
            <td class="num mono">{{ (full.materials.coveringMassG / 1000).toFixed(3) }}</td>
            <td class="num mono">{{ full.batch.coveringMassG.toFixed(1) }}</td>
          </tr>
          <tr>
            <td>扎线重</td>
            <td class="num mono">{{ full.materials.threadMassG.toFixed(1) }}</td>
            <td class="num mono">{{ (full.materials.threadMassG / 1000).toFixed(3) }}</td>
            <td class="num mono">{{ full.batch.threadMassG.toFixed(1) }}</td>
          </tr>
          <tr>
            <td>LED（{{ full.materials.ledCount }} 颗 × 1.2g）</td>
            <td class="num mono">{{ full.materials.ledMassG.toFixed(1) }}</td>
            <td class="num mono">{{ (full.materials.ledMassG / 1000).toFixed(3) }}</td>
            <td class="num mono">{{ full.batch.ledMassG.toFixed(1) }}</td>
          </tr>
          <tr class="led">
            <td>整灯总重（＝逐层受力合计）</td>
            <td class="num mono strong">{{ full.materials.totalMassG.toFixed(1) }} g ＝ {{ full.materials.totalWeightN.toFixed(2) }} N</td>
            <td class="num mono strong">{{ full.materials.totalMassKg.toFixed(3) }}</td>
            <td class="num mono strong">{{ full.batch.totalMassG.toFixed(1) }} / {{ full.batch.totalWeightN.toFixed(2) }}N</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="palette" v-if="!sel.polyMode">
      <h3>分层蒙面用量（按层买布/买纸用）与该层受力</h3>
      <table>
        <thead>
          <tr>
            <th>层</th>
            <th>颜色</th>
            <th class="num">分段高 (mm)</th>
            <th class="num">该层直径 (mm)</th>
            <th class="num">裁片种类</th>
            <th class="num">每块面积 (m²)</th>
            <th class="num">块数</th>
            <th class="num">合计面积 (m²)</th>
            <th class="num">该层受力合计 (g)</th>
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
            <td class="num mono">{{ r.kinds }}</td>
            <td class="num mono">{{ (r.perPiece / 1e6).toFixed(4) }}</td>
            <td class="num mono">{{ r.qty }}</td>
            <td class="num mono">{{ r.areaM2.toFixed(3) }}</td>
            <td class="num mono strong">{{ r.loadG.toFixed(1) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <ChecksPanel :checks="full.checks" :elapsed-ms="full.elapsedMs" title="全量验收自检（§10）" />
  </div>
</template>

<style scoped>
.gate-warn {
  background: #fdecea;
  border: 1px solid #f2c7c1;
  color: var(--red);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
}

.gate-warn a {
  font-weight: 700;
  margin-left: 6px;
}

h2 .rev {
  font-size: 12px;
  font-family: var(--mono);
  color: var(--ink-soft);
  font-weight: 400;
  margin-left: 8px;
}

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

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

button:hover {
  border-color: var(--red);
  color: var(--red);
}

button:disabled:hover {
  border-color: var(--line-strong);
  color: inherit;
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
