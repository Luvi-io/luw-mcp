// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
export const SHOWER_ARM = 'bath-space:shower-arm'
const showerArmStyles = [
  'round-adjustable',
  'square-adjustable',
  'round-straight',
  'round-angled',
  'round-elbow',
  'round-curved',
  'round-gooseneck',
  'square-straight',
  'square-angled',
  'square-elbow',
] as const
const metres = (min: number, max: number, value: number) =>
  z.number().finite().min(min).max(max).default(value)
export const ShowerArmNode = BaseNode.extend({
  id: objectId('bath-space-shower-arm'),
  type: nodeType(SHOWER_ARM),
  children: z.array(z.string()).default([]),
  wallId: z.string().nullable().default(null),
  position: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .default([0, 2.1, 0]),
  rotation: z.number().finite().default(0),
  side: z.enum(['front', 'back']).default('front'),
  style: z.enum(showerArmStyles).default('round-adjustable'),
  length: metres(0.1, 1.2, 0.4),
  tubeSize: metres(0.015, 0.06, 0.025),
  drop: metres(0.04, 0.4, 0.08),
  rise: metres(0.04, 0.4, 0.15),
  bendRadius: metres(0.02, 0.2, 0.06),
  outletAngle: z.number().finite().min(0).max(90).default(90),
  mountingHeight: z.number().finite().default(2.1),
  flangeEnabled: z.boolean().default(true),
  flangeShape: z.enum(['round', 'square']).default('round'),
  flangeSize: metres(0.04, 0.15, 0.065),
  flangeThickness: metres(0.003, 0.03, 0.008),
  connectorLength: metres(0.005, 0.04, 0.015),
  slots: z.record(z.string(), z.string()).optional(),
})
export type ShowerArmNode = z.infer<typeof ShowerArmNode>
export const showerArmPresets: { style: ShowerArmNode['style']; label: string }[] = [
  { style: 'round-adjustable', label: 'Round adjustable' },
  { style: 'square-adjustable', label: 'Square adjustable' },
  { style: 'round-curved', label: 'Round curved' },
  { style: 'round-gooseneck', label: 'Round gooseneck' },
]
export function armOutletAngle(n: ShowerArmNode) {
  return n.style.endsWith('straight')
    ? 0
    : n.style.endsWith('elbow') || n.style.endsWith('curved') || n.style.endsWith('gooseneck')
      ? 90
      : n.outletAngle
}
export function adjustableArmStyle(n: ShowerArmNode): ShowerArmNode['style'] {
  return n.style.endsWith('curved') || n.style.endsWith('gooseneck')
    ? n.style
    : n.style.startsWith('square')
      ? 'square-adjustable'
      : 'round-adjustable'
}
