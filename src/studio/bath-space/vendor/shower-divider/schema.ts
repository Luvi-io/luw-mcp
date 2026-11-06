// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const SHOWER_DIVIDER = 'bath-space:shower-divider'
export const ShowerDividerNode = BaseNode.extend({
  supportSlabId: z.string().optional(),
  id: objectId('bath-space-shower-divider'),
  type: nodeType(SHOWER_DIVIDER),
  position: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .default([0, 0, 0]),
  rotation: z.number().finite().default(0),
  width: z.number().min(0.2).max(8).default(1.2),
  height: z.number().min(0.5).max(3).default(2),
  columns: z.number().int().min(1).max(12).default(1),
  rows: z.number().int().min(1).max(12).default(1),
  frameWidth: z.number().min(0.01).max(0.06).default(0.025),
  frameDepth: z.number().min(0.012).max(0.08).default(0.035),
  barWidth: z.number().min(0.008).max(0.04).default(0.015),
  glassThickness: z.number().min(0.004).max(0.012).default(0.008),
  slots: z.record(z.string(), z.string()).optional(),
})
export type ShowerDividerNode = z.infer<typeof ShowerDividerNode>
export type Point = [number, number]
/** Keep openings positive even at the shortest length and densest grid. */
export function dividerLayout(n: ShowerDividerNode) {
  const frame = Math.min(n.frameWidth, n.width / 8, n.height / 8)
  const bar = Math.min(
    n.barWidth,
    (n.width - 2 * frame) / (2 * n.columns),
    (n.height - 2 * frame) / (2 * n.rows),
  )
  return {
    frame,
    bar,
    innerWidth: n.width - 2 * frame,
    innerHeight: n.height - 2 * frame,
  }
}
export function dividerSegment(a: Point, b: Point, parameters: Partial<ShowerDividerNode> = {}) {
  const width = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (width < 0.2 || width > 8) return null
  return ShowerDividerNode.parse({
    ...parameters,
    id: undefined,
    name: 'Shower divider',
    width,
    position: [(a[0] + b[0]) / 2, parameters.position?.[1] ?? 0, (a[1] + b[1]) / 2],
    rotation: -Math.atan2(b[1] - a[1], b[0] - a[0]),
  })
}
export function dividerRectangle(a: Point, b: Point): [Point, Point][] {
  const corners: Point[] = [a, [b[0], a[1]], b, [a[0], b[1]]]
  return corners.map((point, i) => [point, corners[(i + 1) % 4]!])
}
