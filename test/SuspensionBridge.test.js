import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSuspensionBridge,
  getSuspensionCableHeight,
  SUSPENSION_BRIDGE_LAYOUT
} from '../src/world/SuspensionBridge.js';

test('suspension cable profile meets anchors and tower saddles symmetrically', () => {
  const layout = SUSPENSION_BRIDGE_LAYOUT;
  assert.equal(getSuspensionCableHeight(layout.deckStartX), layout.anchorCableY);
  assert.equal(getSuspensionCableHeight(layout.westTowerX), layout.towerCableY);
  assert.equal(getSuspensionCableHeight(layout.centerX), layout.centerCableY);
  assert.equal(getSuspensionCableHeight(layout.eastTowerX), layout.towerCableY);
  assert.equal(getSuspensionCableHeight(layout.deckEndX), layout.anchorCableY);

  for (let offset = 0; offset <= 50; offset += 2.5) {
    const west = getSuspensionCableHeight(layout.centerX - offset);
    const east = getSuspensionCableHeight(layout.centerX + offset);
    assert.ok(Math.abs(west - east) < 1e-9);
  }
});

test('bridge main cables are continuous and every hanger intersects its cable profile', () => {
  const bridge = createSuspensionBridge();
  const cables = [];
  const hangers = [];
  const anchorages = [];
  const saddles = [];
  bridge.traverse(object => {
    if (object.name.startsWith('main-cable-')) cables.push(object);
    if (object.name === 'vertical-hanger') hangers.push(object);
    if (object.name === 'cable-anchorage') anchorages.push(object);
    if (object.name === 'cable-saddle') saddles.push(object);
  });

  assert.equal(cables.length, 2);
  assert.ok(hangers.length >= 30);
  assert.equal(anchorages.length, 4);
  assert.equal(saddles.length, 4);

  for (const cable of cables) {
    const points = cable.userData.controlPoints;
    assert.equal(points[0].x, SUSPENSION_BRIDGE_LAYOUT.deckStartX);
    assert.equal(points.at(-1).x, SUSPENSION_BRIDGE_LAYOUT.deckEndX);
    for (let i = 1; i < points.length; i += 1) {
      assert.equal(points[i].x - points[i - 1].x, 1);
    }
  }

  for (const hanger of hangers) {
    const height = hanger.geometry.parameters.height;
    const bottomY = hanger.position.y - height * 0.5;
    const topY = hanger.position.y + height * 0.5;
    assert.ok(Math.abs(bottomY - SUSPENSION_BRIDGE_LAYOUT.hangerDeckY) < 1e-9);
    assert.ok(Math.abs(topY - getSuspensionCableHeight(hanger.position.x)) < 1e-9);
  }
});
