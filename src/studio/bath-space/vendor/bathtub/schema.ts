// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const BATHTUB = 'bath-space:bathtub'
const pose = z.object({
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  rotation: z.number().finite().default(0),
})
export const BathtubNode = BaseNode.extend({
  supportSlabId: z.string().optional(),
  id: objectId('bath-space-bathtub'),
  type: nodeType(BATHTUB),
  position: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .default([0, 0, 0]),
  rotation: z.number().finite().default(0),
  children: z.array(z.string()).default([]),
  shape: z
    .enum([
      'oval',
      'rectangle',
      'slipper',
      'clawfoot',
      'back-to-wall',
      'alcove',
      'corner',
      'drop-in',
      'undermount',
      'walk-in',
    ])
    .default('oval'),
  builtInShape: z.enum(['oval', 'rectangle']).default('rectangle'),
  length: z.number().min(1.2).max(2.2).default(1.7),
  width: z.number().min(0.65).max(1.8).default(0.8),
  height: z.number().min(0.45).max(1.15).default(0.58),
  backrestProfile: z
    .enum(['classic', 'curved', 'straight', 'reclined', 'upright'])
    .default('classic'),
  backrestLeftAngle: z.number().min(10).max(55).default(30),
  backrestRightAngle: z.number().min(10).max(55).default(30),
  seatBackrestAngle: z.number().min(0).max(12).default(5),
  bowlDepth: z.number().min(0.3).max(0.55).default(0.43),
  rimWidth: z.number().min(0.035).max(0.12).default(0.065),
  baseStyle: z
    .enum(['automatic', 'integrated', 'claw', 'rounded', 'pedestal'])
    .default('automatic'),
  baseHeight: z.number().min(0.08).max(0.2).default(0.14),
  doorSide: z.enum(['left', 'right']).default('left'),
  doorWidth: z.number().min(0.38).max(0.65).default(0.44),
  doorOpening: z.number().min(0).max(1).default(0),
  thresholdHeight: z.number().min(0.04).max(0.15).default(0.075),
  seatHeight: z.number().min(0.3).max(0.55).default(0.43),
  seatDepth: z.number().min(0.3).max(0.55).default(0.42),
  grabHandles: z.boolean().default(true),
  drainDistance: z.number().finite().min(0).max(1).optional(),
  drainCrossOffset: z.number().finite().min(-0.5).max(0.5).default(0),
  drainEnd: z.enum(['center', 'left', 'right']).default('center'),
  apronThickness: z.number().min(0.015).max(0.05).default(0.025),
  drainCover: z.boolean().default(true),
  overflow: z.boolean().default(true),
  showPlumbing: z.boolean().default(false),
  wasteRecessDepth: z.number().min(0.1).max(0.25).default(0.13),
  wasteOutletAngle: z.number().finite().min(-Math.PI).max(Math.PI).default(0),
  wasteOutletLength: z.number().min(0.08).max(0.4).default(0.15),
  tapMount: z.enum(['wall', 'rim', 'none']).default('wall'),
  tapTarget: pose.optional(),
  wallTapTarget: pose.optional(),
  slots: z.record(z.string(), z.string()).optional(),
})
export type BathtubNode = z.infer<typeof BathtubNode>
export const bathUsesDeck = (node: BathtubNode) =>
  node.shape === 'drop-in' || node.shape === 'undermount'
export const bathHasRimTarget = (node: BathtubNode) =>
  node.tapMount === 'rim' && node.shape !== 'undermount'
export const bathtubPresets = [
  {
    shape: 'walk-in',
    label: 'Walk-in',
    description: 'Low doorway, inward-swinging door, built-in seat and grab handle',
  },
  {
    shape: 'undermount',
    label: 'Undermount',
    description: 'Covered rim and editable oval or rectangular well below a separate deck',
  },
  {
    shape: 'drop-in',
    label: 'Drop-in',
    description: 'Raised rim with a separate deck and derived opening',
  },
  {
    shape: 'corner',
    label: 'Corner',
    description: 'Two straight wall sides and a curved front; equal or asymmetric proportions',
  },
  {
    shape: 'alcove',
    label: 'Alcove',
    description: 'Rectangular surround with front apron and three-wall fitting',
  },
  {
    shape: 'back-to-wall',
    label: 'Back-to-wall',
    description: 'Flat rear shell, oval bowl and wall snapping',
  },
  {
    shape: 'clawfoot',
    label: 'Clawfoot',
    description: 'Raised oval shell on four ball-and-claw feet',
  },
  {
    shape: 'oval',
    label: 'Oval',
    description: 'Curved shell and two sloping backrests',
  },
  {
    shape: 'rectangle',
    label: 'Rounded rectangle',
    description: 'Soft corners and a broad rim',
  },
  {
    shape: 'slipper',
    label: 'Slipper',
    description: 'Raised backrest at one end',
  },
] as const
export const bathBowlDepth = (node: BathtubNode) =>
  Math.min(node.bowlDepth, node.height - bathBaseHeight(node) - 0.07)
export const bathRimWidth = (node: BathtubNode) =>
  Math.max(node.rimWidth, node.tapMount === 'rim' ? 0.09 : 0.035)

export const bathBaseStyle = (node: BathtubNode) =>
  node.shape === 'alcove' ||
  node.shape === 'corner' ||
  node.shape === 'walk-in' ||
  bathUsesDeck(node)
    ? 'integrated'
    : node.baseStyle === 'automatic'
      ? node.shape === 'clawfoot'
        ? 'claw'
        : 'integrated'
      : node.baseStyle
export const bathBaseHeight = (node: BathtubNode) =>
  bathBaseStyle(node) === 'integrated' ? 0 : node.baseHeight

