/**
 * 骨架布局（选型核定与骨架构件表共用的唯一来源）
 *  - 竖篾净长 = segmentInfos 的母线折线长累计（轮廓派生，选型不许再量一遍）
 *  - 横篾圈位置：按选型给出的各层内部加圈道数，把每层沿既有轮廓等分
 *  - 圈周长 = 2πR（圆形）/ n × 底边长（多边形）；半径取自轮廓 sections 同一插值
 *  - 绑扎余量处数沿用既有约定：竖篾两端 2 处；圆形圈 1 处接头，多边形每边 1 处
 * 长度单位 mm，保留 1 位小数（长度）。
 */
import type { Lantern, MemberKind } from './types'
import {
  buildGeometry,
  polygonEdge,
  polyhedronInfo,
  r1,
  segmentInfos,
  shoulderBendRadius,
  TAU,
  type Geometry,
  type SegmentInfo
} from './geometry'

export interface RingPosition {
  /** 稳定编码（跨计算保持一致，供分页长条/预览/对照使用） */
  code: string
  /** 离底高度（mm） */
  yMm: number
  /** 轮廓半径（mm，取自同一 profile 插值） */
  radiusMm: number
  /** 圈净周长（mm，圆形 2πR；多边形 n×边长时为单圈边长合计） */
  perimeterMm: number
  /** 多边形单根横篾边长（mm），即该圈相邻竖篾支点间的跨度 */
  edgeMm: number
  /** 折角（多边形，度） */
  bendAngleDeg?: number
  /** 当前引用所在层（0 起；同一圈在相邻层 plan 中各有一份引用） */
  layerIndex: number
  /** 拥有层（重量、绑扎、总账只在拥有层计一次）：下边界圈归下层，上口圈归顶层 */
  ownerLayerIndex: number
  /** 在所属层的道次（1 = 底边界圈 … totalCourses = 上口圈） */
  courseNo: number
  /** 底口圈 */
  isBase: boolean
  /** 上口收口圈 */
  isMouth: boolean
}

export interface LayerCoursePlan {
  layerIndex: number
  seg: SegmentInfo
  /** 内部加圈道数（不含上下边界圈） */
  innerCourses: number
  /** 圈道总数（含上下边界圈） */
  totalCourses: number
  /** 该层各道圈（底→顶） */
  rings: RingPosition[]
  /** 竖篾在该层的支撑间距（mm，= 该层母线折线长 / 内部道数+1） */
  ribSpanMm: number
}

export interface FrameLayout {
  geometry: Geometry
  segs: SegmentInfo[]
  /** 正多面体布局（棱篾，无层圈） */
  polyhedron: boolean
  polyKind?: 'tetra' | 'octa'
  polyEdgeMm?: number
  /** 竖篾/母线篾净长（折线累计，mm） */
  ribRawMm: number
  /** 各层圈道方案（底→顶） */
  layerPlans: LayerCoursePlan[]
  /** 全灯圈位置（去重后底→顶，相邻层共用边界圈只算一道） */
  rings: RingPosition[]
  /** 实际内部加圈道数（长度 = 层数） */
  innerCourses: number[]
  /** 实际圈道总数（长度 = 层数） */
  totalCourses: number[]
  /** 绑扎余量（每端/每接头，mm） */
  lashMm: number
  polygon: boolean
  n: number
}

/** 不带选型截面的原始构件行（frame.ts 负责挂选定档） */
export interface LayoutMember {
  code: string
  kind: MemberKind
  label: string
  rawLengthMm: number
  lashJoints: number
  qty: number
  group: string
  layerIndex: number
  courseNo?: number
  bendRadiusMm?: number
  bendAngleDeg?: number
  note: string
}

/**
 * 按各层内部加圈道数构建布局。
 * @param innerCoursesReq 各层内部加圈道数（可短于层数，缺省 0）
 */
export function buildLayout(l: Lantern, innerCoursesReq: number[]): FrameLayout {
  const g = buildGeometry(l)
  const segs = segmentInfos(g)
  const lash = Math.max(0, l.lashAllowanceMm)
  const innerCourses = segs.map((_, i) => Math.max(0, Math.round(innerCoursesReq[i] ?? 0)))

  if (l.kind === 'polyhedron') {
    const info = polyhedronInfo(g)
    return {
      geometry: g,
      segs,
      polyhedron: true,
      polyKind: info.kind,
      polyEdgeMm: info.edgeMm,
      ribRawMm: r1(info.edgeMm),
      layerPlans: [],
      rings: [],
      innerCourses: [0],
      totalCourses: [0],
      lashMm: lash,
      polygon: false,
      n: g.n
    }
  }

  const bendAngle = 180 - 360 / g.n
  const layerPlans: LayerCoursePlan[] = []
  const rings: RingPosition[] = []

  segs.forEach((sg, i) => {
    const k = innerCourses[i]
    const total = k + 2
    const plan: LayerCoursePlan = {
      layerIndex: i,
      seg: sg,
      innerCourses: k,
      totalCourses: total,
      rings: [],
      ribSpanMm: r1(sg.slantMm / (k + 1))
    }
    // 道次 1 = 下边界圈；道次 2..k+1 = 内部加圈；道次 k+2 = 上边界圈。
    // 边界圈只在拥有层构建一次（第 1 层拥有底盘圈；上边界圈归拥有层——顶层拥有上口圈），
    // 相邻层在非首道次时通过 boundaryFrom 引用同一圈，重量/绑扎只在拥有层计一次。
    for (let c = 1; c <= total; c++) {
      if (c === 1 && i > 0) {
        // 本层下边界 = 下一层已构建的上边界圈（引用：重量/绑扎仍在 ownerLayerIndex 计）
        const owned = layerPlans[i - 1].rings.find((x) => x.courseNo === layerPlans[i - 1].totalCourses && x.ownerLayerIndex === i - 1)
        if (owned) {
          plan.rings.push({ ...owned, layerIndex: i, courseNo: 1 })
        }
        continue
      }
      const t = (c - 1) / (total - 1)
      const y = r1(sg.y0Mm + (sg.y1Mm - sg.y0Mm) * t)
      const r = radiusFromSeg(sg, t)
      const edge = polygonEdge(r, g.n)
      const isBase = i === 0 && c === 1
      const isMouth = i === segs.length - 1 && c === total
      const ring: RingPosition = {
        code: `R-L${i + 1}-C${c}`,
        yMm: y,
        radiusMm: r1(r),
        perimeterMm: r1(g.polygon ? g.n * edge : TAU * r),
        edgeMm: r1(edge),
        bendAngleDeg: g.polygon ? r1(bendAngle) : undefined,
        layerIndex: i,
        ownerLayerIndex: i,
        courseNo: c,
        isBase,
        isMouth
      }
      plan.rings.push(ring)
      rings.push(ring)
    }
    layerPlans.push(plan)
  })

  const totalCourses = layerPlans.map((p) => p.totalCourses)

  return {
    geometry: g,
    segs,
    polyhedron: false,
    ribRawMm: r1(segs.reduce((s, x) => s + x.slantMm, 0)),
    layerPlans,
    rings,
    innerCourses,
    totalCourses,
    lashMm: lash,
    polygon: g.polygon,
    n: g.n
  }
}

/** 段内轮廓半径（直线段两端插值；与 buildGeometry 同一 profile，不重新采样轮廓） */
function radiusFromSeg(sg: SegmentInfo, t: number): number {
  return sg.r0Mm + (sg.r1Mm - sg.r0Mm) * t
}

/**
 * 由布局展开为原始构件行（不含截面档；截面由选型结论挂接）。
 * 行顺序：竖篾 → 各层横篾圈（底→顶）→ 收口圈/底盘圈已在层圈内 → 走马机构。
 */
export function layoutMembers(layout: FrameLayout, l: Lantern): LayoutMember[] {
  const items: LayoutMember[] = []
  const { lashMm: lash } = layout

  if (layout.polyhedron) {
    const tetra = layout.polyKind === 'tetra'
    items.push({
      code: 'V-EDGE',
      kind: 'vertical',
      label: tetra ? '棱篾（正四面体）' : '棱篾（正八面体）',
      rawLengthMm: r1(layout.polyEdgeMm!),
      lashJoints: 2,
      qty: tetra ? 6 : 12,
      group: '棱篾',
      layerIndex: -1,
      bendAngleDeg: 60,
      note: `端头夹角 60°（正三角形面角，两端各留 ${lash}mm 绑扎余量）`
    })
    return items
  }

  const g = layout.geometry
  items.push({
    code: 'V',
    kind: l.kind === 'prism' || l.kind === 'box' ? 'vertical' : 'rib',
    label: l.kind === 'prism' || l.kind === 'box' ? '竖篾' : '竖篾（母线篾）',
    rawLengthMm: layout.ribRawMm,
    lashJoints: 2,
    qty: g.n,
    group: '竖篾',
    layerIndex: -1,
    note: `沿轮廓折线长（${layout.segs.length} 段累计），两端各留 ${lash}mm；选型跨度按各层支撑间距分层核算`
  })

  for (const ring of layout.rings) {
    const i = ring.layerIndex
    const layerWord = `第 ${i + 1} 层`
    if (ring.isBase) {
      items.push({
        code: ring.code + '-BASE',
        kind: 'base_ring',
        label: '底盘圈',
        rawLengthMm: layout.polygon ? ring.edgeMm : ring.perimeterMm,
        lashJoints: 1,
        qty: layout.polygon ? g.n : 1,
        group: '底盘圈',
        layerIndex: i,
        courseNo: ring.courseNo,
        bendRadiusMm: layout.polygon ? undefined : r1(ring.radiusMm),
        bendAngleDeg: ring.bendAngleDeg,
        note: `底盘外接直径 ${r1(ring.radiusMm * 2)}mm，${layout.polygon ? `合围 ${g.n} 根，每根含 1 处接头余量` : '圆形圈 1 处接头'}`
      })
      continue
    }
    if (ring.isMouth) {
      const shoulderR = r1(
        shoulderBendRadius(g.maxR - ring.radiusMm, g.heightMm * g.kTop)
      )
      items.push({
        code: ring.code + '-MOUTH',
        kind: 'mouth_ring',
        label: '收口圈',
        rawLengthMm: layout.polygon ? ring.edgeMm : ring.perimeterMm,
        lashJoints: 1,
        qty: layout.polygon ? g.n : 1,
        group: '收口圈',
        layerIndex: i,
        courseNo: ring.courseNo,
        bendRadiusMm: layout.polygon ? (shoulderR > 0 ? shoulderR : undefined) : r1(ring.radiusMm),
        bendAngleDeg: ring.bendAngleDeg,
        note: `收口外接直径 ${r1(ring.radiusMm * 2)}mm（${layerWord}第 ${ring.courseNo} 道），${
          layout.polygon
            ? `合围 ${g.n} 根，弯曲半径按收口肩部建议 ${shoulderR > 0 ? shoulderR + 'mm' : '折角成型'}`
            : `弯半径 = 口径/2 = ${r1(ring.radiusMm)}mm`
        }`
      })
      continue
    }
    items.push({
      code: ring.code,
      kind: 'ring',
      label: `${layerWord}第 ${ring.courseNo} 道横篾${layout.polygon ? '' : '圈'}`,
      rawLengthMm: layout.polygon ? ring.edgeMm : ring.perimeterMm,
      lashJoints: 1,
      qty: layout.polygon ? g.n : 1,
      group: layout.polygon ? `横篾（${layerWord}）` : `横篾圈（${layerWord}）`,
      layerIndex: i,
      courseNo: ring.courseNo,
      bendRadiusMm: layout.polygon ? undefined : r1(ring.radiusMm),
      bendAngleDeg: ring.bendAngleDeg,
      note: `圈直径 ${r1(ring.radiusMm * 2)}mm（${layerWord}第 ${ring.courseNo}/${layout.totalCourses[i]} 道），${
        layout.polygon ? `合围 ${g.n} 根，每根含 1 处接头余量，折角 ${r1(180 - 360 / g.n)}°` : '圆形圈 1 处接头'
      }`
    })
  }

  if (l.kind === 'box') {
    items.push({
      code: 'S-AXLE',
      kind: 'spoke',
      label: '中轴（走马灯转轴）',
      rawLengthMm: r1(g.heightMm),
      lashJoints: 2,
      qty: 1,
      group: '走马机构',
      layerIndex: -1,
      note: '贯穿灯体中轴，两端各留绑扎余量（不参与选型受力核算）'
    })
    const topR = g.sections[g.sections.length - 1].radiusMm
    const botR = g.sections[0].radiusMm
    items.push({
      code: 'S-SPOKE',
      kind: 'spoke',
      label: '上下辐条',
      rawLengthMm: r1((botR + topR) / 2),
      lashJoints: 1,
      qty: g.n * 2,
      group: '走马机构',
      layerIndex: -1,
      note: `上 ${g.n} 根 + 下 ${g.n} 根，由中心到棱角支撑中轴（不参与选型受力核算）`
    })
  }

  return items
}
