import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCompactSuspensionBridge,
  getCompactCableHeight
} from '../src/world/CompactSuspensionBridge.js';
import { createBridgeBarrierColliders } from '../src/world/BridgeSafety.js';

function descendantsNamed(root, name) {
  const matches = [];
  root.traverse(child => {
    if (child.name === name) matches.push(child);
  });
  return matches;
}

test('compact suspension bridge builds a complete open-railed crossing', () => {
  const bridge = createCompactSuspensionBridge({
    id: 'test-span',
    centerX: 160,
    centerZ: 50,
    length: 100,
    width: 16,
    towerHeight: 9,
    theme: 'VIOLET'
  });

  assert.equal(bridge.name, 'compact-suspension-bridge-test-span');
  assert.equal(descendantsNamed(bridge, 'compact-suspension-tower').length, 2);
  assert.equal(descendantsNamed(bridge, 'compact-tower-leg').length, 4);
  assert.equal(descendantsNamed(bridge, 'compact-bridge-sidewalk').length, 2);
  assert.equal(descendantsNamed(bridge, 'compact-bridge-guardrail').length, 4);
  assert.ok(descendantsNamed(bridge, 'compact-guardrail-post').length >= 30);
  assert.ok(descendantsNamed(bridge, 'compact-vertical-hanger').length >= 16);
  assert.equal(descendantsNamed(bridge, 'compact-main-cable-north').length, 1);
  assert.equal(descendantsNamed(bridge, 'compact-main-cable-south').length, 1);
});

test('compact suspension cable is symmetric and meets its towers and anchors', () => {
  const bridge = createCompactSuspensionBridge({ length: 40, profile: 'SELF_ANCHORED' });
  const layout = bridge.userData.layout;

  assert.equal(getCompactCableHeight(-layout.length * 0.5, layout), layout.anchorHeight);
  assert.equal(getCompactCableHeight(layout.length * 0.5, layout), layout.anchorHeight);
  assert.equal(getCompactCableHeight(-layout.towerOffset, layout), layout.towerHeight);
  assert.equal(getCompactCableHeight(layout.towerOffset, layout), layout.towerHeight);
  assert.equal(getCompactCableHeight(0, layout), layout.centerCableHeight);
  assert.equal(getCompactCableHeight(-4.5, layout), getCompactCableHeight(4.5, layout));
  assert.ok(layout.towerHeight < 10, 'compact bridge must remain below landmark scale');
});

test('bridge barrier envelopes align to both visible deck edges', () => {
  const bridge = createCompactSuspensionBridge({
    id: 'safe-span',
    centerX: 400,
    centerZ: -50,
    length: 40,
    width: 16,
    profile: 'SELF_ANCHORED'
  });
  const barriers = bridge.userData.barrierColliders;

  assert.equal(barriers.length, 2);
  assert.deepEqual(barriers.map(barrier => barrier.side), ['north', 'south']);
  assert.deepEqual(barriers.map(barrier => barrier.kind), ['bridge-barrier', 'bridge-barrier']);
  assert.deepEqual(barriers.map(barrier => barrier.size), [
    { x: 40, y: 2.2, z: 0.6 },
    { x: 40, y: 2.2, z: 0.6 }
  ]);
  assert.deepEqual(barriers.map(barrier => barrier.position.z), [-57.7, -42.3]);
  assert.deepEqual(barriers.map(barrier => barrier.position.y), [1.1, 1.1]);
});

test('bridge barrier helper rejects incomplete dimensions and supports rotation', () => {
  assert.deepEqual(createBridgeBarrierColliders({ length: 0, width: 16 }), []);

  const barriers = createBridgeBarrierColliders({
    centerX: 10,
    centerZ: 20,
    length: 30,
    width: 12,
    rotationY: Math.PI / 2,
    bridgeId: 'rotated'
  });
  assert.equal(barriers.length, 2);
  assert.ok(Math.abs(barriers[0].position.x - 4.3) < 1e-9);
  assert.ok(Math.abs(barriers[1].position.x - 15.7) < 1e-9);
  assert.ok(Math.abs(barriers[0].position.z - 20) < 1e-9);
  assert.equal(barriers[0].rotationY, Math.PI / 2);
});
