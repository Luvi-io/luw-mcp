// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { TapDetails } from './details.js'
import { tapPresetIds } from './presets.js'

export const TAP = 'bath-space:tap'
export const TapNode = BaseNode.extend({
  id: objectId('bath-space-tap'),
  type: nodeType(TAP),
  presetId: z.enum(tapPresetIds).default('tap-001'),
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).default([0, 0, 0]),
  rotation: z.number().finite().default(0),
  wallId: z.string().nullable().default(null),
  servesBathId: z.string().nullable().default(null),
  servesBasinId: z.string().nullable().default(null),
  slotId: z.string().default('tap'),
  serviceSlotId: z.string().default('tap'),
  linkOffset: z.tuple([z.number().finite(), z.number().finite()]).nullable().default(null),
  side: z.enum(['front', 'back']).default('front'),
  children: z.array(z.string()).default([]),
  height: z.number().min(0.12).max(0.6).optional(),
  reach: z.number().min(0.10).max(0.3).optional(),
  bodyRadius: z.number().min(0.012).max(0.04).optional(),
  slots: z.record(z.string(), z.string()).optional(),
  handleAngle: z.number().min(-0.5).max(0.5).default(0),
  ...TapDetails.shape,
})
export type TapNode = z.infer<typeof TapNode>
