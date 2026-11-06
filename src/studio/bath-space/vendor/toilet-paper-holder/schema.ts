// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
export const TOILET_PAPER_HOLDER = 'bath-space:toilet-paper-holder'
const length = (min: number, max: number, value: number) => z.number().finite().min(min).max(max).default(value)
export const ToiletPaperHolderNode = BaseNode.extend({
  id: objectId('bath-space-paper-holder'), type: nodeType(TOILET_PAPER_HOLDER),
  children: z.array(z.string()).default([]),
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).default([0, 0.7, 0]),
  rotation: z.number().finite().default(0), wallId: z.string().nullable().default(null),
  side: z.enum(['front', 'back']).default('front'), mountingHeight: z.number().finite().default(0.7),
  shape: z.enum(['open', 'double', 'covered']).default('open'),
  width: length(0.14, 0.3, 0.18), projection: length(0.075, 0.18, 0.1),
  rollWidth: length(0.07, 0.13, 0.1), rollRadius: length(0.025, 0.065, 0.055),
  paperLength: length(0, 0.25, 0.055), showRoll: z.boolean().default(true),
  slots: z.record(z.string(), z.string()).optional(),
})
export type ToiletPaperHolderNode = z.infer<typeof ToiletPaperHolderNode>
export const holderPresets = [
  {shape: 'open', label: 'Open arm'}, {shape: 'double', label: 'Double post'}, {shape: 'covered', label: 'Covered'},
] as const
