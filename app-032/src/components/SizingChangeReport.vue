<script setup lang="ts">
/**
 * 选型变更对照：改一次最大直径或换一种蒙面材料后，列出四处各自变了什么
 *  - 构件表：哪几根篾的宽厚与道数变了
 *  - 材料页：哪几项材料与长度变了
 *  - 预览：哪几层的圈变了
 *  - 自检：哪一条结论翻了
 * 没有已存档结论时不显示。
 */
import { computed } from 'vue'
import type { Lantern } from '../core/types'
import type { SizingDiff } from '../core/sizing'

const props = defineProps<{ lantern: Lantern; diff: SizingDiff; scope?: 'all' | 'frame' | 'materials' | 'design' }>()

const scope = computed(() => props.scope || 'all')
const showFrame = computed(() => scope.value === 'all' || scope.value === 'frame')
const showMaterials = computed(() => scope.value === 'all' || scope.value === 'materials')
const showPreview = computed(() => scope.value === 'all' || scope.value === 'design')
const showChecks = computed(() => scope.value === 'all' || scope.value === 'design' || scope.value === 'materials' || scope.value === 'frame')

const flipped = computed(() => props.diff.checks.filter((c) => c.flippedToFail))
</script>

<template>
  <section v-if="diff.hasBaseline" class="chg" :class="{ changed: diff.changed }">
    <header>
      <h3>
        {{ diff.changed ? '⚠ 参数已变：四处相对上一版核定结论的变化' : '与上一版核定结论一致（四处未变）' }}
      </h3>
      <small>上一版：{{ lantern.sizing?.accepted ? 'v' + lantern.sizing.accepted.version : '' }}</small>
    </header>

    <div v-if="!diff.changed" class="same">
      最大直径 / 蒙面等参数改动后重新核算，宽厚、道数与总长均未越过已存档结论。
    </div>

    <template v-else>
      <p class="void-note">
        旧版构件表分组、绑扎余量与受力结论已失效；已存进本机的灯样与已导出的备料单按旧规格作废，已裁好刨好的那批篾退回重新定规格。
      </p>
      <div class="cols">
        <div v-if="showFrame" class="col">
          <h4>① 骨架构件表</h4>
          <p v-if="!diff.frame.length" class="empty">宽厚与道数未变（截取长度可能随几何变化，见材料页）</p>
          <ul>
            <li v-for="(x, i) in diff.frame" :key="'f' + i">
              <span>{{ x.label }}</span>
              <s>{{ x.from }}</s> → <b>{{ x.to }}</b>
            </li>
          </ul>
        </div>
        <div v-if="showMaterials" class="col">
          <h4>② 备料统计与材料页</h4>
          <p v-if="!diff.materials.length" class="empty">材料项与长度未变</p>
          <ul>
            <li v-for="(x, i) in diff.materials" :key="'m' + i">
              <span>{{ x.label }}</span>
              <s>{{ x.from }}</s> → <b>{{ x.to }}</b>
            </li>
          </ul>
        </div>
        <div v-if="showPreview" class="col">
          <h4>③ 参数与灯体预览</h4>
          <p v-if="!diff.preview.length" class="empty">各层圈道数与截面未变</p>
          <ul>
            <li v-for="(x, i) in diff.preview" :key="'p' + i">
              <span>{{ x.label }}</span>
              <s>{{ x.from }}</s> → <b>{{ x.to }}</b>
            </li>
          </ul>
        </div>
        <div v-if="showChecks" class="col">
          <h4>④ 自检结论</h4>
          <ul>
            <li v-for="(x, i) in diff.checks" :key="'c' + i" :class="{ flip: x.flippedToFail }">
              <span>{{ x.id }} {{ x.title.replace(/（.*$/, '') }}</span>
              <s>{{ x.before }}</s> → <b>{{ x.after }}</b>
            </li>
          </ul>
          <p v-if="flipped.length" class="flip-note">
            {{ flipped.map((x) => x.id).join('、') }} 翻为不通过：本版在重新核定存档前不得下料、导出的备料单无效。
          </p>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.chg {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: var(--shadow);
}
.chg.changed {
  border-color: #e8cfa4;
  background: #fffdf7;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}
h3 {
  margin: 0;
  font-size: 14px;
}
header small {
  font-family: var(--mono);
  color: var(--ink-soft);
}
.same {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--jade);
}
.void-note {
  margin: 8px 0;
  font-size: 12px;
  color: #8a4b12;
  background: #fdf3e2;
  border: 1px solid #e8cfa4;
  border-radius: 6px;
  padding: 7px 10px;
  line-height: 1.55;
}
.cols {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.col h4 {
  margin: 0 0 6px;
  font-size: 12.5px;
  color: #8f1c19;
}
.col ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.col li {
  font-size: 11.5px;
  line-height: 1.45;
  background: var(--surface-2);
  border-radius: 5px;
  padding: 5px 7px;
}
.col li span {
  display: block;
  color: var(--ink-soft);
}
.col li s {
  color: #a89a89;
  margin-right: 2px;
}
.col li b {
  color: #8f1c19;
}
.col li.flip {
  background: #fadbd6;
}
.flip-note {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--red);
}
.empty {
  margin: 0;
  font-size: 11px;
  color: var(--ink-soft);
}
@media (max-width: 1100px) {
  .cols {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
