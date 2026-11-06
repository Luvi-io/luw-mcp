// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
export const MIRROR = 'bath-space:mirror'
export const MirrorNode = BaseNode.extend({
  id: objectId('bath-space-mirror'), type: nodeType(MIRROR),
  children: z.array(z.string()).default([]),
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).default([0, 1.5, 0]),
  rotation: z.number().finite().default(0), wallId: z.string().nullable().default(null),
  side: z.enum(['front', 'back']).default('front'),
  mountingHeight: z.number().finite().min(0).max(5).default(1.5),
  shape: z.enum(['rectangle', 'round', 'rounded', 'oval', 'pill', 'arch']).default('rectangle'),
  width: z.number().finite().min(0.3).max(2.4).default(0.8),
  height: z.number().finite().min(0.3).max(2.4).default(0.9),
  depth: z.number().finite().min(0.01).max(0.08).default(0.025),
  frameWidth: z.number().finite().min(0).max(0.08).default(0.02),
  frameEnabled: z.boolean().default(true),
  frameProfile: z.enum(['flat', 'rounded']).default('flat'),
  cornerRadius: z.number().finite().min(0.005).max(.2).default(.06),
  glassThickness: z.number().finite().min(.003).max(.01).default(.004),
  wallGap: z.number().finite().min(0).max(.06).default(.008),
  bevelEnabled: z.boolean().default(true),
  surface: z.enum(['silver', 'bronze', 'smoked']).default('silver'),
  backlight: z.boolean().default(false),
  brightness: z.number().finite().min(0).max(100).default(50),
  temperature: z.enum(['warm', 'neutral', 'cool']).default('warm'),
  slots: z.record(z.string(), z.string()).optional(),
}).overwrite(node => node.shape === 'round' ? { ...node, height: node.width } : node)
export type MirrorNode = z.infer<typeof MirrorNode>
export const mirrorPresets = [
  { shape: 'rectangle', label: 'Rectangular mirror' },
  { shape: 'round', label: 'Round mirror', width: 0.8, height: 0.8 },
  { shape: 'rounded', label: 'Rounded mirror' },
  { shape: 'oval', label: 'Oval mirror', width: .6, height: .9 },
  { shape: 'pill', label: 'Pill mirror', width: .6, height: .9 },
  { shape: 'arch', label: 'Arched mirror', width: .7, height: 1 },
] as const
