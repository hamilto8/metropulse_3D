import * as THREE from 'three';

const PRESET_COORDINATES = Object.freeze({
  birdseye: Object.freeze({ pos: [80, 320, 15], target: [80, 0, 0] }),
  // Central avenue framing: one traffic lane off-center, looking south
  // between downtown blocks without intersecting a building footprint.
  street: Object.freeze({ pos: [3.5, 3.6, 92], target: [3.5, 2.1, -28] }),
  park: Object.freeze({ pos: [-45, 12, -45], target: [-60, 4, -60] }),
  // Elevated east-west road corridor view. Keeping Z at zero preserves a
  // clear skyline sightline between the north and south building rows.
  downtown: Object.freeze({ pos: [122, 64, 0], target: [5, 19, 0] }),
  bridge: Object.freeze({ pos: [160, 28, 65], target: [160, 8, -15] }),
  rocket: Object.freeze({ pos: [670, 52, -245], target: [700, 28, -280] }),
  free: Object.freeze({ pos: [160, 95, 130], target: [80, 0, 0] })
});

export function createCameraPresets() {
  return Object.fromEntries(
    Object.entries(PRESET_COORDINATES).map(([name, preset]) => [
      name,
      {
        pos: new THREE.Vector3(...preset.pos),
        target: new THREE.Vector3(...preset.target)
      }
    ])
  );
}

export { PRESET_COORDINATES };
