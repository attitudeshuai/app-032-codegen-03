/** 导出：构件清单 / 裁片清单 / 备料单（CSV，本地生成，无外部请求） */
import type { FrameMember, Lantern, Panel } from './types'
import type { BatchMaterials, SingleLightMaterials } from './materials'
import { coveringSpec } from './craft'

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: (string | number)[][]): string {
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function membersCsv(l: Lantern, members: FrameMember[]): string {
  const rows: (string | number)[][] = [
    [`花灯构件清单 · ${l.name}`],
    [`最大直径 ${l.maxDiameterMm}mm / 总高 ${l.totalHeightMm}mm / 绑扎余量 每端 ${l.lashAllowanceMm}mm / 选型版次 R${l.selection?.revision ?? 0} / 生成 ${new Date().toLocaleString()}`],
    [],
    ['构件名称', '类别', '分组', '规格档', '截面宽(mm)', '截面厚(mm)', '净长(mm)', '截取长度(mm,含余量)', '余量处数', '数量', '总截取长度(mm)', '单根重(g)', '弯曲半径(mm)', '折角(°)', '备注']
  ]
  for (const m of members) {
    rows.push([
      m.label,
      kindName(m.kind),
      m.group,
      m.gradeId || '—',
      m.widthMm ? m.widthMm.toFixed(1) : '—',
      m.thicknessMm ? m.thicknessMm.toFixed(1) : '—',
      m.rawLengthMm.toFixed(1),
      m.lengthMm.toFixed(1),
      m.lashJoints,
      m.qty,
      (m.lengthMm * m.qty).toFixed(1),
      m.massEachG ? m.massEachG.toFixed(1) : '—',
      m.bendRadiusMm ? m.bendRadiusMm.toFixed(1) : '—',
      m.bendAngleDeg ? m.bendAngleDeg.toFixed(1) : '—',
      m.note || ''
    ])
  }
  const stock = members.reduce((s, m) => s + m.lengthMm * m.qty, 0)
  const raw = members.reduce((s, m) => s + m.rawLengthMm * m.qty, 0)
  const mass = members.reduce((s, m) => s + (m.massEachG || 0) * m.qty, 0)
  rows.push([])
  rows.push(['合计', '', '', '', '', '', raw.toFixed(1), '', '', members.reduce((s, m) => s + m.qty, 0), stock.toFixed(1), mass.toFixed(1), '', '', `备料 ${(stock / 1000).toFixed(3)}m / 骨架自重 ${(mass / 1000).toFixed(3)}kg`])
  return toCsv(rows)
}

export function panelsCsv(l: Lantern, panels: Panel[]): string {
  const rows: (string | number)[][] = [
    [`蒙面裁片清单 · ${l.name}`],
    [`蒙面 ${coveringSpec(l.covering).name} / 缝份 每边 ${l.seamAllowanceMm}mm（已含在裁片尺寸内）/ 生成 ${new Date().toLocaleString()}`],
    [],
    ['裁片编号', '名称', '形状', '净上宽(mm)', '净下宽(mm)', '净高(mm)', '裁切上宽(mm)', '裁切下宽(mm)', '裁切高(mm)', '半径/对边(mm)', '数量', '对位标记数']
  ]
  for (const p of panels) {
    rows.push([
      p.id,
      p.label,
      shapeName(p.shape),
      p.rawWidthTopMm.toFixed(1),
      p.rawWidthBottomMm.toFixed(1),
      p.rawHeightMm.toFixed(1),
      p.widthTopMm.toFixed(1),
      p.widthBottomMm.toFixed(1),
      p.heightMm.toFixed(1),
      p.radiusMm ? p.radiusMm.toFixed(1) : '—',
      p.qty,
      p.marksMm.length
    ])
  }
  return toCsv(rows)
}

export function materialsCsv(
  l: Lantern,
  single: SingleLightMaterials,
  batch: BatchMaterials
): string {
  const cov = coveringSpec(l.covering)
  const rows: (string | number)[][] = [
    [`备料单 · ${l.name}`],
    [`生成 ${new Date().toLocaleString()} / 单位 mm·m²·m·g·kg·N / 选型版次 R${l.selection?.revision ?? 0}（改直径/蒙面后未重新确认的备料单作废）`],
    [],
    ['项目', '单灯用量', '单位', `批量 ${batch.count} 个（含 ${(batch.wasteRatio * 100).toFixed(0)}% 损耗）`],
    ['竹篾/铁丝（含绑扎余量）', single.frameM.toFixed(3), 'm', batch.frameM.toFixed(3)],
    ['竹篾构件净长', single.frameRawM.toFixed(3), 'm', batch.frameRawM.toFixed(3)],
    [`蒙面（${cov.name}，含缝份）`, single.coveringM2.toFixed(3), 'm²', batch.coveringM2.toFixed(3)],
    ['蒙面净面积（不含缝份）', single.coveringNetM2.toFixed(3), 'm²', batch.coveringNetM2.toFixed(3)],
    ['扎线', single.lashM.toFixed(3), 'm', batch.lashM.toFixed(3)],
    ['胶', single.glueG.toFixed(1), 'g', batch.glueG.toFixed(1)],
    ['LED 灯珠建议', single.ledCount, '颗', batch.ledCount],
    [],
    ['分规格竹篾用料（按选型核定同一份数）', '单灯长度(m)', '单灯重(g)', `批量 ${batch.count} 个长度(m)`]
  ]
  for (const gl of single.gradeLengths) {
    if (gl.lengthMm <= 0) continue
    rows.push([
      `${gl.grade.name} ${gl.grade.widthMm.toFixed(1)}×${gl.grade.thicknessMm.toFixed(1)}mm（${gl.grade.id}）`,
      (gl.lengthMm / 1000).toFixed(3),
      gl.massG.toFixed(1),
      ((gl.lengthMm / 1000) * batch.count * (1 + batch.wasteRatio)).toFixed(3)
    ])
  }
  rows.push([])
  rows.push(['重量账（逐层合计与总重一致，CHK-11）', '单灯(g)', '', `批量 ${batch.count} 个(g)`])
  rows.push(['竹篾骨架自重', single.frameMassG.toFixed(1), 'g', batch.frameMassG.toFixed(1)])
  rows.push(['蒙面材料重（含缝份）', single.coveringMassG.toFixed(1), 'g', batch.coveringMassG.toFixed(1)])
  rows.push(['扎线重', single.threadMassG.toFixed(1), 'g', batch.threadMassG.toFixed(1)])
  rows.push(['LED 重', single.ledMassG.toFixed(1), 'g', batch.ledMassG.toFixed(1)])
  rows.push(['整灯总重', single.totalMassG.toFixed(1), 'g', batch.totalMassG.toFixed(1)])
  rows.push(['整灯总重', single.totalMassKg.toFixed(3), 'kg', batch.totalMassKg.toFixed(3)])
  rows.push(['整灯总重换算受力', single.totalWeightN.toFixed(2), 'N', batch.totalWeightN.toFixed(2)])
  rows.push([])
  rows.push(['灯体体积', single.volumeL.toFixed(3), 'L', batch.volumeL.toFixed(3)])
  rows.push(['灯体表面积', single.surfaceM2.toFixed(3), 'm²', batch.surfaceM2.toFixed(3)])
  return toCsv(rows)
}

export function kindName(k: FrameMember['kind']): string {
  const map: Record<FrameMember['kind'], string> = {
    vertical: '竖篾',
    ring: '横篾',
    mouth_ring: '收口圈',
    base_ring: '底盘圈',
    rib: '母线篾',
    spoke: '辐条/中轴'
  }
  return map[k]
}

export function shapeName(s: Panel['shape']): string {
  const map: Record<Panel['shape'], string> = {
    trapezoid: '梯形',
    rectangle: '矩形',
    sector: '扇形',
    circle: '圆形/正多边形',
    triangle: '三角形'
  }
  return map[s]
}
