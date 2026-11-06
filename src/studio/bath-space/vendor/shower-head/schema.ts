// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
export const SHOWER_HEAD = 'bath-space:shower-head'
const styles = ['round-rain', 'square-rain', 'soft-square', 'rectangular', 'compact', 'bell'] as const
const metres = (min: number, max: number, value: number) => z.number().finite().min(min).max(max).default(value)
export const ShowerHeadNode = BaseNode.extend({
  id: objectId('bath-space-shower-head'), type: nodeType(SHOWER_HEAD),
  children: z.array(z.string()).default([]), slotId: z.literal('shower-head').default('shower-head'),
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).default([0,0,0]),
  rotation: z.number().finite().default(0), style: z.enum(styles).default('round-rain'),
  width: metres(.06,.6,.25), depth: metres(.06,.6,.25), thickness: metres(.008,.1,.018),
  neckLength: metres(.015,.15,.035), neckDiameter: metres(.015,.05,.022),
  cornerRadius: metres(.002,.12,.025), bellHeight: metres(.03,.18,.075),
  nozzleSpacing: metres(.008,.045,.018), nozzleDiameter: metres(.0015,.006,.003),
  nozzleLayout: z.enum(['grid','rings']).default('rings'), nozzlesEnabled: z.boolean().default(true),
  tilt: z.number().finite().min(-20).max(20).default(0), swivel: z.number().finite().min(-180).max(180).default(0),
  slots: z.record(z.string(),z.string()).optional(),
})
export type ShowerHeadNode = z.infer<typeof ShowerHeadNode>
export const showerHeadPresets: {style: ShowerHeadNode['style']; label: string; width: number; depth: number; nozzleLayout: ShowerHeadNode['nozzleLayout']}[] = [
  {style:'round-rain',label:'Round rain',width:.25,depth:.25,nozzleLayout:'rings'},
  {style:'square-rain',label:'Square rain',width:.25,depth:.25,nozzleLayout:'grid'},
  {style:'soft-square',label:'Rounded square',width:.25,depth:.25,nozzleLayout:'grid'},
  {style:'rectangular',label:'Rectangular rain',width:.4,depth:.25,nozzleLayout:'grid'},
  {style:'compact',label:'Compact round',width:.1,depth:.1,nozzleLayout:'rings'},
  {style:'bell',label:'Classic bell',width:.18,depth:.18,nozzleLayout:'rings'},
]
