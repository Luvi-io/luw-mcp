// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
export const SHOWER_MOUNT = 'bath-space:shower-mount'
const styles = [
  'round-holder',
  'square-holder',
  'adjustable-holder',
  'round-combined',
  'square-combined',
  'round-outlet',
  'square-outlet',
  'round-rail',
  'square-rail',
] as const
const metres = (min: number, max: number, value: number) =>
  z.number().finite().min(min).max(max).default(value)
export const ShowerMountNode = BaseNode.extend({
  id: objectId('bath-space-shower-mount'),
  type: nodeType(SHOWER_MOUNT),
  children: z.array(z.string()).default([]),
  wallId: z.string().nullable().default(null),
  position: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .default([0, 1.2, 0]),
  rotation: z.number().finite().default(0),
  side: z.enum(['front', 'back']).default('front'),
  mountingHeight: z.number().finite().default(1.2),
  style: z.enum(styles).default('round-holder'),
  tubeSize: metres(0.015, 0.05, 0.024),
  flangeEnabled: z.boolean().default(true),
  flangeSize: metres(0.035, 0.12, 0.055),
  flangeThickness: metres(0.003, 0.025, 0.008),
  projection: metres(0.025, 0.15, 0.06),
  holderDiameter: metres(0.022, 0.06, 0.034),
  holderDepth: metres(0.018, 0.06, 0.032),
  outletLength: metres(0.012, 0.045, 0.024),
  railBracketInset: metres(0.015, 0.12, 0.045),
  shelfDepth: metres(0.06, 0.16, 0.1),
  adjustmentLever: z.boolean().optional(),
  holderTilt: z.number().finite().min(-30).max(45).default(15),
  railLength: metres(0.3, 1.5, 0.7),
  sliderPosition: z.number().finite().min(0).max(1).default(0.65),
  railSupply: z.boolean().default(false),
  shelfEnabled: z.boolean().default(false),
  shelfWidth: metres(0.1, 0.3, 0.18),
  slots: z.record(z.string(), z.string()).optional(),
})
export type ShowerMountNode = z.infer<typeof ShowerMountNode>
export const isRail = (n: ShowerMountNode) => n.style.endsWith('rail')
export const hasHolder = (n: ShowerMountNode) => !n.style.endsWith('outlet')
export const hasSupply = (n: ShowerMountNode) =>
  n.style.endsWith('outlet') || n.style.endsWith('combined') || (isRail(n) && n.railSupply)
export const showerMountPresets: {
  style: ShowerMountNode['style']
  label: string
  category: 'holder' | 'outlet' | 'rail'
}[] = [
  { style: 'round-holder', label: 'Round holder', category: 'holder' },
  { style: 'square-holder', label: 'Square holder', category: 'holder' },
  { style: 'adjustable-holder', label: 'Adjustable holder', category: 'holder' },
  { style: 'round-combined', label: 'Round holder and outlet', category: 'holder' },
  { style: 'square-combined', label: 'Square holder and outlet', category: 'holder' },
  { style: 'round-outlet', label: 'Round supply elbow', category: 'outlet' },
  { style: 'square-outlet', label: 'Square supply elbow', category: 'outlet' },
  { style: 'round-rail', label: 'Round slide rail', category: 'rail' },
  { style: 'square-rail', label: 'Square slide rail', category: 'rail' },
]

export type MountType = 'holder' | 'outlet' | 'rail'
export type MountShape = 'round' | 'square'
export const mountType = (n: ShowerMountNode): MountType =>
  isRail(n) ? 'rail' : hasHolder(n) ? 'holder' : 'outlet'
export const mountShape = (n: ShowerMountNode): MountShape =>
  n.style.startsWith('square') ? 'square' : 'round'
export const hasAdjustmentLever = (n: ShowerMountNode) =>
  n.adjustmentLever ?? n.style === 'adjustable-holder'
export function mountStyle(
  type: MountType,
  shape: MountShape,
  supply: boolean,
): ShowerMountNode['style'] {
  return `${shape}-${type === 'holder' && supply ? 'combined' : type}` as ShowerMountNode['style']
}
