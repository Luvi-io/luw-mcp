// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
export const tapPresets = [
  { id: 'tap-017', label: 'Three-hole mixer', mount: 'countertop', design: 'arc', mountingLayout: 'three-hole', height: .26, reach: .17, bodyRadius: .018, thumbnail: new URL('./assets/tap-017.webp', import.meta.url).href },
  { id: 'tap-001', label: 'Arc', mount: 'countertop', design: 'arc', height: 0.32, reach: 0.16, bodyRadius: 0.024, thumbnail: new URL('./assets/tap-001.webp', import.meta.url).href },
  { id: 'tap-002', label: 'Flat lever', mount: 'countertop', design: 'lever', height: 0.2, reach: 0.15, bodyRadius: 0.025, thumbnail: new URL('./assets/tap-002.webp', import.meta.url).href },
  { id: 'tap-004', label: 'Waterfall', mount: 'countertop', design: 'waterfall', height: 0.19, reach: 0.15, bodyRadius: 0.025, thumbnail: new URL('./assets/tap-004.webp', import.meta.url).href },
  { id: 'tap-005', label: 'Square arc', mount: 'countertop', design: 'square-arc', height: 0.33, reach: 0.17, bodyRadius: 0.018, thumbnail: new URL('./assets/tap-005.webp', import.meta.url).href },
  { id: 'tap-006', label: 'Slim arc', mount: 'countertop', design: 'arc', height: 0.34, reach: 0.16, bodyRadius: 0.015, thumbnail: new URL('./assets/tap-006.webp', import.meta.url).href },
  { id: 'tap-007', label: 'Swan neck', mount: 'countertop', design: 'swan', height: 0.36, reach: 0.18, bodyRadius: 0.021, thumbnail: new URL('./assets/tap-007.webp', import.meta.url).href },
  { id: 'tap-008', label: 'Vintage', mount: 'countertop', design: 'vintage', height: 0.25, reach: 0.17, bodyRadius: 0.025, thumbnail: new URL('./assets/tap-008.webp', import.meta.url).href },
  { id: 'tap-009', label: 'Tall vintage', mount: 'countertop', design: 'vintage-arc', height: 0.38, reach: 0.16, bodyRadius: 0.022, thumbnail: new URL('./assets/tap-009.webp', import.meta.url).href },
  { id: 'tap-010', label: 'Spring pullout', mount: 'countertop', design: 'spring', height: 0.48, reach: 0.2, bodyRadius: 0.024, thumbnail: new URL('./assets/tap-010.webp', import.meta.url).href },
  { id: 'tap-011', label: 'Sculpted', mount: 'countertop', design: 'sculpted', height: 0.26, reach: 0.17, bodyRadius: 0.029, thumbnail: new URL('./assets/tap-011.webp', import.meta.url).href },
  { id: 'tap-012', label: 'Square lever', mount: 'countertop', design: 'lever', height: 0.25, reach: 0.16, bodyRadius: 0.025, thumbnail: new URL('./assets/tap-012.webp', import.meta.url).href },
  { id: 'tap-013', label: 'Twin knob', mount: 'countertop', design: 'twin', height: 0.31, reach: 0.17, bodyRadius: 0.019, thumbnail: new URL('./assets/tap-013.webp', import.meta.url).href },
  { id: 'tap-014', label: 'Lever arc', mount: 'countertop', design: 'arc', height: 0.3, reach: 0.16, bodyRadius: 0.023, thumbnail: new URL('./assets/tap-014.webp', import.meta.url).href },
  { id: 'tap-015', label: 'High arc', mount: 'countertop', design: 'arc', height: 0.34, reach: 0.17, bodyRadius: 0.022, thumbnail: new URL('./assets/tap-015.webp', import.meta.url).href },
  { id: 'tap-003', label: 'Plate spout', mount: 'wall', design: 'plate', height: 0.2, reach: 0.18, bodyRadius: 0.024, thumbnail: new URL('./assets/tap-003.webp', import.meta.url).href },
  { id: 'tap-016', label: 'Wall mixer', mount: 'wall', design: 'mixer', height: 0.12, reach: 0.2, bodyRadius: 0.025, thumbnail: new URL('./assets/tap-016.webp', import.meta.url).href },
] as const

export type TapPresetId = typeof tapPresets[number]['id']
export const tapPresetIds = tapPresets.map(preset => preset.id) as [TapPresetId, ...TapPresetId[]]
export function getTapPreset(id: TapPresetId) {
  return tapPresets.find(preset => preset.id === id)!
}

export function tapMountingLayout(node: { presetId: TapPresetId; mountingLayout?: 'single-hole' | 'three-hole' }) {
  const preset = getTapPreset(node.presetId)
  return preset.mount === 'wall' ? 'single-hole' : node.mountingLayout ?? ('mountingLayout' in preset ? preset.mountingLayout : 'single-hole')
}
