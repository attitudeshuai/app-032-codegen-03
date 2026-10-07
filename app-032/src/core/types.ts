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
  selection: StripSelection
  /** 已导出备料单/构件清单登记（选型翻版后旧单作废） */
  exportRecords: ExportRecord[]
  createdAt: string
  updatedAt: string
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
  /** 选型核定：规格档 id（G1~G7） */
  gradeId?: string
  /** 选型核定：截面宽 mm（1 位小数） */
  widthMm?: number
  /** 选型核定：截面厚 mm（1 位小数） */
  thicknessMm?: number
  /** 选型核定：所属层索引（横篾圈/竖篾），-1 为收口/底盘/机构 */
  layerIndex?: number
  /** 选型核定：0=原有圈，1+=补加的横篾圈（道序） */
  extraCourse?: number
  /** 单根篾重 g（按选定截面与截取长度） */
  massEachG?: number
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
}

/** 选型判定方式：全灯统一最不利一档 / 逐层各选一档 */
export type SelectionMode = 'uniform' | 'perlayer'

/** 已确认基线快照（结构与 core/selection 的 SelectionSnapshot 一致；只用于重算对照） */
export interface SelectionSnapshotShape {
  revision: number
  signature: string
  confirmedAt: string
  mode: SelectionMode
  ribGrade: string
  ringGrades: string[]
  extraRings: number[]
  frameMm: number
  frameRawMm: number
  frameMassG: number
  covering: Covering
  coveringM2: number
  members: { label: string; gradeId: string; widthMm: number; thicknessMm: number; extraCourse: number; lengthTotalMm: number }[]
  gradeLengths: Record<string, number>
  layerRings: { band: number; bottomNodeGrade: string; topNodeGrade: string; extras: number }[]
  checks: { c9: boolean; c10: boolean; c11: boolean }
}

/**
 * 竹篾规格选型状态（存在灯样上，同一份结论供四处使用）
 * - mode：判定方式；ribGrade：竖篾档（逐层模式也只有一档竖篾）
 * - ringGrades：各节点圈档（长度 = layers 数 +1，底盘→收口）
 * - extraRings：每一层（band）补加横篾圈道数（长度 = layers 数）
 * - revision：确认版次，翻一次结论 +1，旧版构件表/余量/受力结论即失效
 * - confirmedSignature：确认时灯样关键参数指纹；与当前不一致即「改了参数，结论待重算确认」
 */
export interface StripSelection {
  mode: SelectionMode
  ribGrade: string
  ringGrades: string[]
  extraRings: number[]
  revision: number
  confirmedSignature: string
  confirmedAt: string
  /** 最近一次被放弃方案让出的代价说明（模式切换/重选时记录） */
  abandonedPathNote: string
  /** 已确认基线快照（重算对照用；存本机，不参与几何计算） */
  baseline?: import('./types').SelectionSnapshotShape
}

/** 已导出备料单登记（存在灯样上；选型翻版后旧单标记作废） */
export interface ExportRecord {
  kind: 'materials' | 'members' | 'panels'
  filename: string
  at: string
  revision: number
  signature: string
  /** true = 选型翻版或参数改动后已作废 */
  voided: boolean
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
