/** 花灯放样数据模型（对齐规格书 §7，并补充放样所需的展开参数） */

export type LanternKind = 'prism' | 'revolution' | 'polyhedron' | 'box'
export type MouthStyle = 'flat' | 'taper' | 'gourd'
export type Covering = 'xuan' | 'silk' | 'parchment'
export type PageSize = 'A4' | 'A3'
export type PanelShape = 'trapezoid' | 'rectangle' | 'sector' | 'circle' | 'triangle'
export type MemberKind = 'vertical' | 'ring' | 'mouth_ring' | 'base_ring' | 'rib' | 'spoke'

export interface Point2 {
  x: number
  y: number
}

/** 分段（层）：高度为准，直径为轮廓派生结果 */
export interface LayerSpec {
  heightMm: number
  diameterMm: number
}

export interface Lantern {
  id: string
  kind: LanternKind
  name: string
  /** 最大直径（灯体最粗处） */
  maxDiameterMm: number
  /** 总高（= 各分段高度之和） */
  totalHeightMm: number
  /** 收口直径（上口） */
  mouthDiameterMm: number
  /** 底口直径（下口） */
  baseDiameterMm: number
  /** 棱数（prism/box）；旋转体时作为竖篾（母线篾）根数 */
  sides: number
  /** 分段高度与直径 */
  layers: LayerSpec[]
  /** 上收口方式 */
  mouthStyle: MouthStyle
  /** 下收口方式 */
  bottomStyle: MouthStyle
  /** 收口曲线强度 0~1 */
  smoothness: number
  /** 葫芦/花瓶形贝塞尔控制点（归一化：x 为半径插值比例，y 为肩部区间比例） */
  ctrl1: Point2
  ctrl2: Point2
  /** 旋转体母线等分数（默认 24，可调） */
  divisions: number
  /** 蒙面类型 */
  covering: Covering
  /** 缝份（mm，四边各加） */
  seamAllowanceMm: number
  /** 绑扎余量（mm，每端） */
  lashAllowanceMm: number
  /** 每层配色（长度 = layers.length，可短于层数则回落到主色） */
  layerColors: string[]
  /** 主色 */
  color: string
  /** 批量制灯数量 */
  batchCount: number
  /** 损耗率 0~0.2 */
  wasteRatio: number
  /** 1:1 打印纸张 */
  pageSize: PageSize
  /** 长条图跨页搭接量（mm） */
  overlapMm: number
  /** 竹篾规格选型核定状态 */
  sizing?: LanternSizingState
  createdAt: string
  updatedAt: string
}

export type SizingMode = 'uniform' | 'byLayer'

/** 选型结论的「同一组数」签名：四处（构件表/材料页/预览/自检）必须与此一致 */
export interface SizingChoiceSignature {
  mode: SizingMode
  /** 竖篾选定档 */
  verticalGradeId: string
  /** 各层横篾选定档（长度 = layers.length） */
  layerGradeIds: string[]
  /** 各层内部加圈道数（不含上下边界圈） */
  innerCourses: number[]
  /** 各层圈道总数（含上下边界圈） */
  totalCourses: number[]
}

/** 核定通过并存档的结论快照（改参数后与现状对照，翻了即作废） */
export interface SizingSnapshot {
  version: number
  acceptedAt: string
  choice: SizingChoiceSignature
  frameStockMm: number
  frameRawMm: number
  ringCountTotal: number
  bambooMassG: number
  coveringMassG: number
  lashMassG: number
  ledMassG: number
  totalMassG: number
  passed: boolean
}

/** 作废 / 处置台账条目（存进本机的灯样与导出的备料单作废都要落账） */
export interface SizingLedgerEntry {
  id: string
  at: string
  kind: 'accept' | 'void-param' | 'void-mode' | 'remedy'
  reason: string
  detail: string
  fromVersion?: number
  /** 被放弃的那条路在材料与加工上让出的代价 */
  givenUp?: string
}

export interface LanternSizingState {
  /** 判定方式：全灯统一选一档 / 逐层各选一档 */
  mode: SizingMode
  /** 统一模式人工选定档；null = 按最不利层自动取档 */
  uniformGradeId: string | null
  /** 逐层内部加圈道数覆盖（null = 按建议）；长度可短于层数 */
  courseOverrides?: (number | null)[]
  /** 逐层档覆盖（仅 byLayer；null = 按建议） */
  gradeOverrides?: (string | null)[]
  /** 最近核定通过并存档的结论；参数/模式变动后与现状不符即作废 */
  accepted?: SizingSnapshot | null
  /** 最近一次被作废的存档（作废后仍作为变更对照基线，直到再次核定） */
  lastVoided?: SizingSnapshot | null
  /** 作废与处置台账（最新在前） */
  ledger?: SizingLedgerEntry[]
}

export interface FrameMember {
  id: string
  kind: MemberKind
  /** 名称，如「竖篾」「第 3 层横篾」「收口圈」 */
  label: string
  /** 截取长度（已含绑扎余量） */
  lengthMm: number
  /** 净长（不含余量） */
  rawLengthMm: number
  /** 选定竹篾档 id（选型核定结论，四处同一组数） */
  gradeId?: string
  /** 选定档名称 */
  gradeName?: string
  /** 截面宽（mm，1 位小数） */
  widthMm?: number
  /** 截面厚（mm，1 位小数） */
  thicknessMm?: number
  /** 所属层（0 起；竖篾与非分层件为 -1） */
  layerIndex?: number
  /** 横篾圈在该层的道次（1 起） */
  courseNo?: number
  /** 建议弯曲半径（圆形圈 / 收口段） */
  bendRadiusMm?: number
  /** 折角（多边形圈的转角，度） */
  bendAngleDeg?: number
  /** 数量 */
  qty: number
  /** 分组：所属层或类别 */
  group: string
  /** 每根含几处绑扎余量 */
  lashJoints: number
  note?: string
}

export interface PanelMark {
  x: number
  y: number
  label: string
}

export interface Panel {
  id: string
  label: string
  shape: PanelShape
  /** 裁片下宽（已含缝份） */
  widthBottomMm: number
  /** 裁片上宽（已含缝份） */
  widthTopMm: number
  /** 裁片高（已含缝份） */
  heightMm: number
  seamAllowanceMm: number
  marksMm: PanelMark[]
  qty: number
  /** 展开净尺寸（不含缝份） */
  rawWidthTopMm: number
  rawWidthBottomMm: number
  rawHeightMm: number
  /** 圆形/正多边形裁片半径（净，不含缝份） */
  radiusMm?: number
  /** 正多边形边数（顶/底盖为多边形时） */
  polySides?: number
  /** 对应灯体层的索引（-1 表示顶/底盖） */
  layerIndex: number
  color: string
  note?: string
}

export interface MaterialTally {
  /** 备料竹篾/铁丝总长（m，含绑扎余量与损耗） */
  frameM: number
  /** 蒙面面积（m²，含缝份与损耗） */
  coveringM2: number
  /** 损耗率 */
  wasteRatio: number
  /** 扎线（m） */
  lashM: number
  /** 胶（g） */
  glueG: number
  /** LED 灯珠建议数量 */
  ledCount?: number
  /** 竹篾骨架自重（g，按选定截面与含余量截取长度） */
  bambooMassG?: number
  /** 蒙面重量（g，按含缝份裁片面积与克重） */
  coveringMassG?: number
  /** 扎线重量（g） */
  lashMassG?: number
  /** LED 含线重量（g） */
  ledMassG?: number
  /** 灯体总重（g = 骨 + 蒙面 + 扎线 + LED） */
  totalMassG?: number
}

/** 构件与裁片的自检结果（对应规格书 §10） */
export interface CheckResult {
  id: string
  title: string
  pass: boolean
  detail: string
  /** 相关数值，便于界面展示 */
  value?: string
}
