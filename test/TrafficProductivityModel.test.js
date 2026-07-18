import test from 'node:test';
import assert from 'node:assert/strict';

import { AlertService } from '../src/alerts/AlertService.js';
import { EconomySystem } from '../src/systems/EconomySystem.js';
import { TrafficAlertAdapter } from '../src/systems/TrafficAlertAdapter.js';
import {
  BRIDGE_POLICIES,
  TrafficProductivityModel,
  validateTrafficProductivityState
} from '../src/systems/TrafficProductivityModel.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';

function harness({ roads = [], outcomes = null } = {}) {
  const economy = new EconomySystem({
    initialTreasury: 50_000,
    passiveIncomeRate: 20,
    population: 4_000,
    happiness: 75,
    services: {
      power: { capacity: 100, demand: 100 },
      water: { capacity: 100, demand: 100 },
      fire: { capacity: 100, demand: 100 }
    }
  });
  economy.registerBuilding({
    id: 'operations-hub',
    jobCapacity: 3_500,
    grossIncomeRate: 80,
    operatingCostRate: 10
  });
  const roadState = { segments: roads };
  const outcomeState = outcomes || {
    revision: 0,
    traffic: {},
    serviceOutages: {},
    infrastructure: {}
  };
  const model = new TrafficProductivityModel({
    economySystem: economy,
    outcomeService: { snapshot: () => outcomeState },
    roadProvider: () => roadState,
    presentationVehicleCap: 48
  });
  return { economy, model, roadState, outcomeState };
}

test('aggregate mobility is immutable, deterministic, and drives economy feedback', () => {
  const { economy, model } = harness();
  const snapshot = model.snapshot();
  const city = economy.snapshot();

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.network), true);
  assert.ok(snapshot.network.congestion > 0);
  assert.ok(snapshot.productivity.multiplier < 1);
  assert.equal(city.mobility.congestion, snapshot.network.congestion);
  assert.equal(city.budgetBreakdown.mobilityProductivityMultiplier, snapshot.productivity.multiplier);
  assert.equal(city.demographics.accessibleEmployed < city.demographics.employed, true);
  assert.equal(city.happinessBreakdown.traffic, snapshot.satisfaction.modifier);
});

test('connected roads add capacity while disconnected road changes remain a visible, explainable blocker', () => {
  const { model, roadState } = harness({
    roads: [{ id: 'road-a', connected: false, position: { x: 20, z: 20 } }]
  });
  const disconnected = model.snapshot();
  assert.equal(disconnected.network.disconnectedRoadSegments, 1);
  assert.ok(disconnected.network.hotspots.some(hotspot => hotspot.id === 'road-a'));

  roadState.segments = [
    { id: 'road-a', connected: true, position: { x: 20, z: 20 } },
    { id: 'road-b', connected: true, position: { x: 50, z: 20 } }
  ];
  const connected = model.update(1);
  assert.equal(connected.network.connectedRoadSegments, 2);
  assert.equal(connected.network.disconnectedRoadSegments, 0);
  assert.ok(connected.network.capacity > disconnected.network.capacity);
  assert.ok(connected.network.congestion < disconnected.network.congestion);
});

test('freight priority has a complete legible tradeoff and persists through restore', () => {
  const { economy, model } = harness();
  const balanced = model.snapshot();
  const priority = model.setBridgePolicy(BRIDGE_POLICIES.FREIGHT_PRIORITY);

  assert.ok(priority.bridge.capacity > balanced.bridge.capacity);
  assert.ok(priority.deliveries.reliability > balanced.deliveries.reliability);
  assert.ok(priority.satisfaction.modifier < balanced.satisfaction.modifier);
  assert.equal(priority.policy.operatingCostRate, 2);
  assert.equal(economy.snapshot().budgetBreakdown.managementCostRate, 2);
  assert.match(priority.policy.tradeoff, /\$120\/min/);

  const saved = model.serialize();
  validateTrafficProductivityState(saved);
  model.setBridgePolicy(BRIDGE_POLICIES.BALANCED);
  model.restore(saved);
  assert.equal(model.bridgePolicy, BRIDGE_POLICIES.FREIGHT_PRIORITY);
  assert.throws(() => model.restore({ version: 1, bridgePolicy: 'MAGIC_LANE' }), /Unsupported bridge policy/);
});

test('bridge closures and outages alter street directives and mission availability/difficulty', () => {
  const outcomes = {
    revision: 2,
    traffic: {
      'primary-bridge': {
        districtId: 'PRIMARY_BRIDGE_CORRIDOR',
        densityMultiplier: 1.5,
        access: 'CLOSED',
        hazardLevel: 0.6
      }
    },
    serviceOutages: {
      'bridge-power': {
        active: true,
        districtId: 'PRIMARY_BRIDGE_CORRIDOR',
        severity: 1
      }
    },
    infrastructure: {}
  };
  const { model } = harness({ outcomes });
  const snapshot = model.snapshot();
  const crossingMission = {
    missionType: 'COURIER',
    pickup: { x: 0, z: 0 },
    dropoff: { x: 300, z: 0 }
  };
  const localMission = {
    missionType: 'TAXI',
    pickup: { x: -50, z: 0 },
    dropoff: { x: 50, z: 0 }
  };

  assert.equal(snapshot.bridge.access, 'CLOSED');
  assert.equal(snapshot.bridge.outageActive, true);
  assert.equal(model.getStreetDirective({ x: 155, z: 0 }).speedMultiplier, 0);
  assert.equal(model.getMissionImpact(crossingMission).available, false);
  assert.equal(model.getMissionImpact(localMission).available, true);
  assert.notEqual(model.getMissionImpact(localMission).difficulty, 'NORMAL');
});

test('visible traffic metrics are explicitly a sample of the aggregate owner', () => {
  const { model } = harness();
  const traffic = Object.create(TrafficSystem.prototype);
  traffic.app = { trafficProductivityModel: model };
  traffic.vehicles = [
    { isParked: false, speed: 0, crashed: true, mesh: { position: { x: 155, z: 0 } } },
    { isParked: false, speed: 0, mesh: { position: { x: 10, z: 0 } } }
  ];

  const metrics = traffic.getCongestionMetrics();
  assert.equal(metrics.authoritative, true);
  assert.equal(metrics.index, model.snapshot().network.congestion);
  assert.equal(metrics.visibleSample.index, 1);
  assert.equal(metrics.visibleSample.sampleKind, 'PRESENTATION_ONLY');
  assert.notEqual(metrics.index, metrics.visibleSample.index);
});

test('structured traffic alerts report aggregate productivity, bridge access, and delivery consequences', () => {
  const outcomes = {
    revision: 1,
    traffic: {
      'primary-bridge': {
        districtId: 'PRIMARY_BRIDGE_CORRIDOR',
        densityMultiplier: 2,
        access: 'CLOSED',
        hazardLevel: 1
      }
    },
    serviceOutages: {
      'bridge-relay': { active: true, districtId: 'PRIMARY_BRIDGE_CORRIDOR', severity: 3 }
    },
    infrastructure: {}
  };
  const { model } = harness({ outcomes });
  const alerts = new AlertService();
  const adapter = new TrafficAlertAdapter({ model, alertService: alerts });
  const active = alerts.snapshot().active;

  assert.ok(active.some(alert => alert.dedupeKey === 'traffic:network-congestion'));
  assert.ok(active.some(alert => alert.dedupeKey === 'traffic:bridge-disruption'));
  assert.ok(active.some(alert => alert.dedupeKey === 'traffic:delivery-reliability'));
  assert.match(active.find(alert => alert.dedupeKey === 'traffic:network-congestion').cause, /productivity/);
  adapter.dispose();
});
