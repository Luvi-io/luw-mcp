// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
export const TOWEL_RAIL = 'bath-space:towel-rail'
export const TowelRailNode = BaseNode.extend({
  id: objectId('bath-space-towel-rail'), type: nodeType(TOWEL_RAIL),
  children: z.array(z.string()).default([]),
  position: z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]).default([0,1.2,0]),
  rotation: z.number().finite().default(0),wallId:z.string().nullable().default(null),
  side:z.enum(['front','back']).default('front'),
  mountingHeight:z.number().finite().min(0).max(5).default(1.2),
  shape:z.enum(['single','double']).default('single'),
  width:z.number().finite().min(0.3).max(1.2).default(0.6),
  height:z.literal(0.05).default(0.05),
  depth:z.number().finite().min(0.06).max(0.25).default(0.1),
  slots:z.record(z.string(),z.string()).optional(),
})
export type TowelRailNode = z.infer<typeof TowelRailNode>
export const towelRailPresets = [{shape:'single',label:'Single towel rail'},{shape:'double',label:'Double towel rail'}] as const
