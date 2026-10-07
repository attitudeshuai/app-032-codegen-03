# 花灯骨架放样与蒙面裁片 · Lantern Frame Lofting

纯前端工具：选灯型 → 填直径/高度/收口 → 出「每根竹篾截多长、弯什么角度」的骨架件表、带缝份的蒙面裁片、以及可 100% 打印的 1:1 放样图与备料单。无后端、无网络请求，断网可用。

## 技术栈

- Vue 3（`<script setup>` 单文件组件）+ TypeScript + Vite 6
- 状态：Vue 自带 `ref / reactive / computed / watch`（无 Pinia / Vuex）
- 额外依赖仅 `vue-router` 4（规格书要求的 6 个路由）
- 手写 CSS；无 UI 组件库、无图表库、无游戏引擎/物理库
- 字体、灯型数据包（`src/data/lantern-types.json`）全部本地打包，无外网 CDN

## 目录结构

```
.
├─ index.html
├─ package.json / tsconfig.json / vite.config.ts
├─ Dockerfile / docker-compose.yml / nginx.conf
├─ .dockerignore / .gitignore
├─ lantern-frame-lofting.md          # 规格书
└─ src/
   ├─ main.ts / App.vue / env.d.ts
   ├─ router/index.ts                # 6 个路由
   ├─ components/
   │  ├─ LanternPreview.vue          # 正视 / 俯视 / 等轴测 + 圈道按选型截面着色
   │  ├─ PanelDiagram.vue            # 裁片尺寸箭头 + 缝份虚线 + 对位十字
   │  ├─ SizingConsole.vue           # 竹篾规格选型核定（判定方式/拦住/两条补救路/台账）
   │  ├─ SizingChangeReport.vue      # 改参数后四处变更对照
   │  └─ ChecksPanel.vue             # 断言结果面板（CHK-01 ~ CHK-11）
   ├─ core/
   │  ├─ types.ts                    # 数据模型（规格书 §7，含选型状态/快照/台账）
   │  ├─ geometry.ts                 # 轮廓 / 分段 / 周长 / 面积 / 体积
   │  ├─ layout.ts                   # 骨架布局：竖篾净长/各层圈道/周长（选型与构件表唯一来源）
   │  ├─ sizing.ts                   # 竹篾选型：受力估算/选档/拦住/补救路/快照/变更对照
   │  ├─ frame.ts                    # 骨架构件表（按选型结论重建：净长+绑扎余量+截面）
   │  ├─ panels.ts                   # 展开裁片（含缝份与对位标记）
   │  ├─ materials.ts                # 备料统计（按截面档）、重量账（g/kg）与批量汇总
   │  ├─ craft.ts                    # 工艺参数、竹篾档库、蒙面克重
   │  ├─ paginate.ts                 # 1:1 分页（裁片不跨页、长条搭接）
   │  ├─ checks.ts                   # computeAll + CHK-01~11 断言（09 选型/10 重量守恒/11 四处同数）
   │  ├─ exporter.ts                 # CSV 导出（带截面与重量）
   │  └─ store.ts                    # localStorage 灯样库 + 核定/作废/补救动作
   └─ views/                         # / · /design · /frame · /panels · /print · /materials
```

## 启动

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # vue-tsc --noEmit && vite build
npm run preview
```

## Docker 构建

```bash
docker compose build
docker compose up -d            # http://localhost:8112
curl http://localhost:8112/healthz
docker compose down
```

多阶段：`node:20-alpine` 构建 → `nginx:1.27-alpine` 只托管 `dist/` 与 `nginx.conf`（SPA 回退、哈希资源 immutable、index.html no-cache、gzip、SVG MIME、`/healthz` 健康检查）。

## 验收结果（规格书 §10）

| 用例 | 结果 | 关键证据 |
| --- | --- | --- |
| 几何手算核对 | 通过 | 正六棱柱底边(D200) 100.000 / 手算 100.000（Δ0.000）；正八棱柱 76.537 / 76.537；圆形周长 628.319 / 628.319；六边形周长 600.000 / 600.000 |
| 竖篾 = 分段高累计 | 通过 | 六角宫灯：竖篾净长 306.8mm，分段高累计 300.0，母线折线长累计 306.8（收口段横向偏移 6.8mm），Δ折线 0.0mm |
| 缝份 = 净尺寸 + 缝份×边数 | 通过 | 6/6 种裁片三向均 = 净尺寸 + 10.0×2mm；图上实线=裁切线、绿色虚线=净样 |
| 备料守恒 | 通过 | 六角宫灯 Σ备料 5.209m / Σ净长 4.369m，差值 840.0mm = 余量总和；莲花灯 Σ备料 8.524m / Σ净长 8.004m，差 520.0mm |
| 面积核对 | 通过 | 六角宫灯 裁片净面积 0.186m² / 灯体表面积 0.186m² = 100.02%；莲花灯 0.311 / 0.309 = 100.67%（∈[0.97,1.03]） |
| 分页 | 通过 | 6 种裁片每块只出现在一页且完整，超区整块输出 0 块；跨页仅骨架长条，带对位十字与搭接 10.0mm |
| 批量守恒 | 通过 | 20 个 × 1.10 损耗：竹篾 5.209 → 114.598m（= 5.209×20×1.10）；蒙面 0.284 → 6.248m² |
| 1:1 打印 | 通过 | `@page { size: 210mm 297mm; margin: 0 }`，图纸宽 793.6875px = 210.0mm；100mm 校验尺实测 377.946px = 99.9991mm（误差 0.0009mm ≤ 1mm） |
| 性能 | 通过 | 计算耗时 0.7 ~ 3.5ms（< 100ms，含选型核定与分页） |
| 竹篾选型核定 | 通过 | 竖篾/各层横篾按跨度·重量·弯形自动选档与道数；D1200 大灯笼自动在肩层加圈（2→3 道）；D2600×800 羊皮纸重灯判「跨度太长」拦住，换粗一档/多添一圈两条路均带代价试算 |
| 重量逐层守恒 | 通过 | 各灯型「逐层承担合计 = 竹+蒙面+扎线+LED」Δ ≤ 0.01g（CHK-10）；六角宫灯 120.4g = 竹40.2 + 蒙面45.7 + 扎线10.5 + LED24.0，逐层 75.8/56.8/53.9/32.5g 合计 120.4g |
| 四处同一组数 | 通过 | 构件表截面、材料页分档截长与重量、预览圈道色、CHK-09~11 全部取自同一选型结论（CHK-11）；改最大直径/换蒙面即列出四处差异并作废旧版，导出在未核定时拦截 |

自检面板（每页底部）显示 **11 / 11 通过**（核定存档后 CHK-09 才记通过；撑不住时当场拦住并判不通过），浏览器控制台无报错。
