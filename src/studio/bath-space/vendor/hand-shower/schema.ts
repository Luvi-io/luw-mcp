// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
export const HAND_SHOWER = 'bath-space:hand-shower'
const styles = ['round', 'square', 'soft-square', 'oval', 'round-wand', 'square-wand'] as const
const metres = (min: number, max: number, value: number) =>
  z.number().finite().min(min).max(max).default(value)
export const HandShowerNode = BaseNode.extend({
  id: objectId('bath-space-hand-shower'),
  type: nodeType(HAND_SHOWER),
  children: z.array(z.string()).default([]),
  slotId: z.literal('hand-shower').default('hand-shower'),
  position: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .default([0, 0, 0]),
  rotation: z.number().finite().default(0),
  style: z.enum(styles).default('round'),
  headWidth: metres(0.055, 0.16, 0.1),
  headHeight: metres(0.055, 0.18, 0.1),
  headThickness: metres(0.01, 0.035, 0.02),
  handleLength: metres(0.1, 0.24, 0.15),
  handleDiameter: metres(0.018, 0.035, 0.024),
  cornerRadius: metres(0.003, 0.04, 0.018),
  connectorLength: metres(0.012, 0.035, 0.018),
  gripRidges: z.boolean().default(false),
  gripInsertion: metres(0.01, 0.055, 0.03),
  headAngle: z.number().finite().min(-15).max(40).default(10),
  nozzleSpacing: metres(0.007, 0.025, 0.012),
  nozzleDiameter: metres(0.0015, 0.005, 0.0025),
  nozzlesEnabled: z.boolean().default(true),
  selectorEnabled: z.boolean().default(true),
  slots: z.record(z.string(), z.string()).optional(),
})
export type HandShowerNode = z.infer<typeof HandShowerNode>
export const handShowerPresets: { style: HandShowerNode['style']; label: string; headHeight?: number }[] = [
  { style: 'round', label: 'Round' },
  { style: 'square', label: 'Square' },
  { style: 'soft-square', label: 'Soft square' },
  { style: 'oval', label: 'Oval', headHeight: .135 },
  { style: 'round-wand', label: 'Round wand' },
  { style: 'square-wand', label: 'Square baton' },
]
