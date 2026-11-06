// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
export const WALL_HUNG_TOILET = 'bath-space:wall-hung-toilet'
const metres = (min: number, max: number, value: number) =>
  z.number().finite().min(min).max(max).default(value)
export const WallHungToiletNode = BaseNode.extend({
  id: objectId('bath-space-wall-hung-toilet'),
  type: nodeType(WALL_HUNG_TOILET),
  children: z.array(z.string()).default([]),
  wallId: z.string().nullable().default(null),
  position: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .default([0, 0.42, 0]),
  rotation: z.number().finite().default(0),
  side: z.enum(['front', 'back']).default('front'),
  style: z
    .enum(['rounded', 'd-shaped', 'square', 'compact', 'elongated'])
    .default('d-shaped'),
  width: metres(0.32, 0.48, 0.36),
  depth: metres(0.42, 0.75, 0.54),
  height: metres(0.22, 0.38, 0.3),
  mountingHeight: z.number().finite().default(0.42),
  wallThickness: metres(0.012, 0.035, 0.02),
  taper: metres(0, 0.45, 0.24),
  seatThickness: metres(0.012, 0.04, 0.022),
  seatEnabled: z.boolean().default(true),
  lidEnabled: z.boolean().default(true),
  lidOpen: z.boolean().default(false),
  rimless: z.boolean().default(true),
  tankType: z
    .enum(['concealed', 'attached', 'low-level', 'high-level'])
    .default('concealed'),
  tankWidth: metres(0.28, 0.55, 0.36),
  tankDepth: metres(0.12, 0.24, 0.16),
  tankHeight: metres(0.28, 0.5, 0.36),
  tankBottom: z.number().finite().default(0.85),
  flushControlsSeparated: z.boolean().default(false),
  pipeDiameter: metres(0.035, 0.06, 0.045),
  slots: z.record(z.string(), z.string()).optional(),
})
export type WallHungToiletNode = z.infer<typeof WallHungToiletNode>
export const toiletPresets = [
  { style: 'rounded', label: 'Rounded', depth: 0.54, taper: 0.32 },
  { style: 'd-shaped', label: 'D-shaped', depth: 0.54, taper: 0.24 },
  { style: 'square', label: 'Soft square', depth: 0.54, taper: 0.08 },
  { style: 'compact', label: 'Compact', depth: 0.46, taper: 0.25 },
  { style: 'elongated', label: 'Elongated', depth: 0.64, taper: 0.24 },
] as const
export function toiletLayout(n: WallHungToiletNode) {
  const external = n.tankType !== 'concealed'
  const rearSpace = n.tankType === 'attached' ? n.tankDepth : 0
  const tankBottom =
    n.tankType === 'attached'
      ? n.mountingHeight + 0.04
      : Math.max(
          n.mountingHeight + 0.08,
          n.tankType === 'high-level'
            ? Math.max(1.5, n.tankBottom)
            : n.tankBottom,
        )
  return {
    external,
    rearSpace,
    projection: n.depth + rearSpace,
    tankBottom,
    totalHeight: Math.max(
      n.mountingHeight +
        n.seatThickness +
        (n.lidEnabled ? (n.lidOpen ? n.depth + 0.005 : 0.015) : 0),
      external ? tankBottom + n.tankHeight + 0.018 : 0,
    ),
  }
}
