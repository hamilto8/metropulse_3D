import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISTRICT_IDS,
  ECONOMY_EVENTS,
  EconomySystem,
  SERVICE_TYPES
} from '../src/systems/EconomySystem.js';

test('treasury earn/spend operations are validated and insufficient debits are atomic', () => {
  const economy = new EconomySystem({ initialTreasury: 100 });

  assert.equal(economy.earn(25, { source: 'mission', referenceId: 'taxi-1' }), 125);
  assert.equal(economy.spend(20, { source: 'building' }), true);
  assert.equal(economy.treasury, 105);
  assert.equal(economy.spend(106), false);
  assert.equal(economy.treasury, 105);
  assert.equal(economy.revision, 2);
  assert.throws(() => economy.earn(-1), /greater than or equal to zero/);
  assert.throws(() => economy.spend(Number.NaN), /finite number/);
});

test('deterministic update applies base and operational-building passive income', () => {
  const economy = new EconomySystem({
    initialTreasury: 10,
    passiveIncomeRate: 2
  });
  economy.registerBuilding({
    id: 'shop-1',
    value: 500,
    employees: 4,
    status: 'ACTIVE',
    passiveIncomeRate: 3
  });
  economy.registerBuilding({
    id: 'closed-shop',
    operational: false,
    passiveIncomeRate: 100
  });

  assert.equal(economy.passiveIncomeRate, 5);
  assert.equal(economy.update(2.5), 12.5);
  assert.equal(economy.treasury, 22.5);
  assert.equal(economy.update(0), 0);

  economy.removeBuilding('shop-1');
  assert.equal(economy.passiveIncomeRate, 2);
  assert.equal(economy.update(1), 2);
  assert.equal(economy.treasury, 24.5);
  assert.throws(() => economy.update(-1), /deltaSeconds/);
});

test('operating upkeep produces deterministic deficits without allowing invalid negative cash', () => {
  const economy = new EconomySystem({ initialTreasury: 100 });
  economy.registerBuilding({
    id: 'public-clinic',
    grossIncomeRate: 2,
    operatingCostRate: 5
  });

  assert.equal(economy.getBudgetBreakdown().netRate, -3);
  assert.equal(economy.update(10), -30);
  assert.equal(economy.treasury, 70);
  assert.equal(economy.update(100), -70);
  assert.equal(economy.treasury, 0);
  assert.equal(economy.snapshot().fiscalStatus, 'INSOLVENT');
});

test('jobs, housing, demand, and happiness expose an explainable labor-market feedback loop', () => {
  const economy = new EconomySystem({ population: 100, happiness: 70 });
  economy.registerBuilding({ id: 'workshop', jobCapacity: 31 });

  const state = economy.snapshot();
  assert.equal(state.demographics.workforce, 62);
  assert.equal(state.demographics.employed, 31);
  assert.equal(state.demographics.unemploymentRate, 0.5);
  assert.equal(state.happinessBreakdown.employment, -7.5);
  assert.equal(state.cityPulse.happiness, 62.5);
  assert.ok(state.demand.operations > 0);
});

test('zoning effects replace and remove cleanly without clamping the base happiness value', () => {
  const economy = new EconomySystem({ happiness: 99, landValue: 100 });
  economy.setZoneEffect({
    id: '0,0',
    type: 'RESIDENTIAL',
    x: 0,
    z: 0,
    happinessModifier: 4,
    landValueModifier: 2
  });
  assert.equal(economy.snapshot().cityPulse.happiness, 100);

  economy.setZoneEffect({
    id: '0,0',
    type: 'INDUSTRIAL',
    x: 0,
    z: 0,
    happinessModifier: -2,
    landValueModifier: -1
  });
  assert.equal(economy.getZoneEffect('0,0').type, 'OPERATIONS');
  assert.equal(economy.snapshot().cityPulse.happiness, 97);
  economy.removeZoneEffect('0,0');
  assert.equal(economy.snapshot().cityPulse.happiness, 99);
  assert.equal(economy.snapshot().cityPulse.landValue, 100);
});

test('buildings contribute data, population, happiness, land value, and services', () => {
  const economy = new EconomySystem({
    population: 100,
    happiness: 50,
    landValue: 200,
    services: {
      power: { capacity: 80, demand: 40 },
      water: { capacity: 20, demand: 10 },
      fire: { capacity: 5, demand: 5 }
    }
  });

  economy.registerBuilding({
    id: 'garden-tower',
    name: 'Garden Tower',
    type: 'RESIDENTIAL',
    value: 480_000,
    employees: 12,
    residents: 40,
    status: 'ACTIVE',
    happinessModifier: 8,
    landValueModifier: 15,
    services: {
      power: { capacity: 20, demand: 60 },
      water: { demand: 10 },
      fire: { demand: 5 }
    }
  });

  const state = economy.snapshot();
  assert.equal(state.cityPulse.population, 140);
  assert.equal(state.cityPulse.happiness, 53);
  assert.ok(Math.abs(state.cityPulse.landValue - 206.04166666666666) < 1e-9);
  assert.equal(state.cityPulse.employees, 12);
  assert.equal(state.cityPulse.totalBuildingValue, 480_000);
  assert.equal(state.services.power.capacity, 100);
  assert.equal(state.services.power.demand, 100);
  assert.equal(state.cityPulse.energy, 100);
  assert.equal(state.services.water.coverage, 1);
  assert.equal(state.services.fire.coverage, 0.5);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.buildings[0].services.power), true);

  economy.removeBuilding('garden-tower');
  assert.equal(economy.snapshot().cityPulse.population, 100);
  assert.equal(economy.removeBuilding('missing'), null);
});

test('parcel land value uses proximity to amenities and active Mayhem zones', () => {
  const economy = new EconomySystem({ landValue: 100 });
  economy.registerBuilding({
    id: 'river-park',
    landValueModifier: 20,
    position: { x: 0, z: 0 },
    amenityRadius: 100
  });
  economy.recordIncident({
    id: 'tower-rubble',
    type: 'BUILDING_DESTROYED',
    landValueModifier: -30,
    position: { x: 0, z: 0 },
    influenceRadius: 50
  });

  const center = economy.getLandValueBreakdownAt(0, 0);
  assert.equal(center.amenityModifier, 20);
  assert.equal(center.mayhemModifier, -30);
  assert.equal(center.landValue, 90);
  assert.equal(economy.getLandValueAt(25, 0), 100);
  assert.equal(economy.getLandValueAt(75, 0), 105);
  assert.equal(economy.getLandValueAt(100, 0), 100);
  assert.equal(Object.isFrozen(center), true);

  // City Pulse retains the established aggregate behavior while parcel reads
  // expose the spatial contrast needed by zoning and inspection systems.
  assert.equal(economy.snapshot().cityPulse.landValue, 90);
  economy.resolveIncident('tower-rubble');
  assert.equal(economy.getLandValueAt(0, 0), 120);

  assert.throws(
    () => economy.registerBuilding({ id: 'invalid-amenity', amenityRadius: 25 }),
    /position is required/
  );
  assert.throws(
    () => economy.recordIncident({ id: 'invalid-zone', influenceRadius: 25 }),
    /position is required/
  );
});

test('mission completion atomically rewards shared funds and advances narrative once', () => {
  const economy = new EconomySystem({ initialTreasury: 50, reputation: 2 });
  const events = [];
  economy.subscribe(event => events.push(event));

  assert.equal(economy.completeMission({
    id: 'taxi-neotech',
    reward: 400,
    narrativeProgressDelta: 2,
    reputationDelta: 3
  }), true);

  assert.equal(economy.treasury, 450);
  assert.equal(economy.narrativeProgress, 2);
  assert.equal(economy.reputation, 5);
  assert.equal(economy.hasCompletedMission('taxi-neotech'), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, ECONOMY_EVENTS.MISSION_COMPLETED);

  assert.equal(economy.completeMission({
    id: 'taxi-neotech',
    reward: 9999,
    narrativeProgressDelta: 99
  }), false);
  assert.equal(economy.treasury, 450);
  assert.equal(economy.narrativeProgress, 2);
  assert.equal(events.length, 1);
});

test('recordMissionCompletion adapter delegates without weakening duplicate protection', () => {
  const economy = new EconomySystem();
  const mission = { id: 'courier-1', narrativeProgressDelta: 2 };

  assert.equal(
    economy.recordMissionCompletion(mission, 250, { satisfaction: 84 }),
    true
  );
  const completion = economy.snapshot().completedMissions[0];
  assert.equal(economy.treasury, 250);
  assert.equal(completion.id, 'courier-1');
  assert.equal(completion.satisfaction, 84);
  assert.equal(completion.narrativeProgressDelta, 2);
  assert.equal(economy.recordMissionCompletion(mission, 999), false);
  assert.equal(economy.treasury, 250);
});

test('incidents create active City Pulse modifiers and persistent reputation effects', () => {
  const economy = new EconomySystem({
    happiness: 70,
    landValue: 100,
    reputation: 10
  });

  economy.recordIncident({
    id: 'bridge-chaos',
    type: 'TRAFFIC_JAM',
    severity: 4,
    reputationDelta: -5,
    happinessModifier: -20,
    landValueModifier: -30
  });

  let state = economy.snapshot();
  assert.equal(state.reputation, 5);
  assert.equal(state.cityPulse.happiness, 50);
  assert.equal(state.cityPulse.landValue, 70);
  assert.equal(state.incidents[0].active, true);

  assert.equal(economy.resolveIncident('bridge-chaos'), true);
  assert.equal(economy.resolveIncident('bridge-chaos'), false);
  state = economy.snapshot();
  assert.equal(state.reputation, 5);
  assert.equal(state.cityPulse.happiness, 70);
  assert.equal(state.cityPulse.landValue, 100);
  assert.equal(state.incidents[0].active, false);
});

test('incident identifiers can be checked before recording persistent world events', () => {
  const economy = new EconomySystem();

  assert.equal(economy.hasIncident('mayhem-building-existing-1-1'), false);
  economy.recordIncident({ id: 'mayhem-building-existing-1-1' });
  assert.equal(economy.hasIncident('mayhem-building-existing-1-1'), true);
  assert.throws(() => economy.hasIncident(''), /incident id must be a non-empty string/);
});

test('service and City Pulse setters preserve domain invariants', () => {
  const economy = new EconomySystem();

  economy.setService(SERVICE_TYPES.POWER, { capacity: 90, demand: 100 });
  economy.adjustService(SERVICE_TYPES.POWER, {
    capacityDelta: 10,
    demandDelta: -20
  });
  economy.setPopulation(2_450);
  economy.adjustPopulation(50);
  economy.setHappiness(95);
  economy.adjustHappiness(10);
  economy.setLandValue(120);
  economy.adjustLandValue(-20);

  const state = economy.snapshot();
  assert.equal(state.services.power.capacity, 100);
  assert.equal(state.services.power.demand, 80);
  assert.equal(state.cityPulse.population, 2_500);
  assert.equal(state.cityPulse.happiness, 100);
  assert.equal(state.cityPulse.landValue, 100);
  assert.throws(() => economy.setService('police', {}), /service must be one of/);
  assert.throws(() => economy.adjustPopulation(0.5), /integer/);
  assert.throws(() => economy.setHappiness(101), /between 0 and 100/);
  economy.adjustLandValue(-101);
  assert.equal(economy.snapshot().cityPulse.landValue, 0);
});

test('service shortages reduce passive income, happiness, and land value', () => {
  const economy = new EconomySystem({
    passiveIncomeRate: 100,
    happiness: 80,
    landValue: 200,
    services: {
      power: { capacity: 50, demand: 100 },
      water: { capacity: 25, demand: 100 },
      fire: { capacity: 0, demand: 100 }
    }
  });

  assert.ok(Math.abs(economy.passiveIncomeRate - 55) < 1e-9);
  const state = economy.snapshot();
  assert.equal(state.cityPulse.happiness, 58.75);
  assert.equal(state.cityPulse.landValue, 162.5);
  assert.equal(state.cityPulse.serviceHealth, 25);

  economy.setService(SERVICE_TYPES.WATER, { capacity: 100, demand: 100 });
  economy.setService(SERVICE_TYPES.FIRE, { capacity: 100, demand: 100 });
  assert.ok(Math.abs(economy.passiveIncomeRate - 70) < 1e-9);
  assert.ok(economy.snapshot().cityPulse.happiness > state.cityPulse.happiness);
});

test('East Cyber-Metropolis unlock is affordability-gated and deducts once', () => {
  const economy = new EconomySystem({
    initialTreasury: 99,
    eastDistrictUnlockCost: 100
  });

  assert.equal(
    economy.isDistrictUnlocked(DISTRICT_IDS.EAST_CYBER_METROPOLIS),
    false
  );
  assert.equal(economy.unlockEastDistrict(), false);
  assert.equal(economy.treasury, 99);

  economy.earn(1);
  assert.equal(economy.canUnlockDistrict(DISTRICT_IDS.EAST_CYBER), true);
  assert.equal(economy.canUnlockDistrict(DISTRICT_IDS.EAST_CYBER_METROPOLIS), true);
  assert.equal(economy.unlockDistrict(DISTRICT_IDS.EAST_CYBER), true);
  assert.equal(economy.treasury, 0);
  assert.equal(economy.unlockEastDistrict(), false);
  assert.equal(
    economy.isDistrictUnlocked(DISTRICT_IDS.EAST_CYBER_METROPOLIS),
    true
  );
  const state = economy.snapshot();
  assert.equal(state.cash, 0);
  assert.equal(state.population, state.cityPulse.population);
  assert.equal(state.energy, state.cityPulse.energy);
  assert.equal(state.happiness, state.cityPulse.happiness);
  assert.deepEqual(state.unlockedDistricts, [
    DISTRICT_IDS.EAST_CYBER_METROPOLIS,
    DISTRICT_IDS.EAST_CYBER
  ]);
});

test('subscriptions emit immutable snapshots and stop after unsubscribe', () => {
  const economy = new EconomySystem({ initialTreasury: 10 });
  const events = [];
  const unsubscribe = economy.subscribe(event => events.push(event), {
    emitCurrent: true
  });

  economy.earn(5);
  assert.equal(events[0].type, ECONOMY_EVENTS.SNAPSHOT);
  assert.equal(events[1].type, ECONOMY_EVENTS.TREASURY_CHANGED);
  assert.equal(events[1].previous.treasury, 10);
  assert.equal(events[1].current.treasury, 15);
  assert.equal(Object.isFrozen(events[1].current.cityPulse), true);

  assert.equal(unsubscribe(), true);
  economy.earn(5);
  assert.equal(events.length, 2);
  assert.equal(unsubscribe(), false);
  assert.throws(() => economy.subscribe('listener'), /listener must be a function/);
});

test('versioned economy persistence restores treasury, buildings, missions, and districts', () => {
  const source = new EconomySystem({
    initialTreasury: 1_000,
    passiveIncomeRate: 12,
    population: 100,
    happiness: 70,
    landValue: 120,
    eastDistrictUnlockCost: 500
  });
  source.registerBuilding({
    id: 'saved-building',
    name: 'Saved Plaza',
    population: 20,
    employees: 4,
    position: { x: 10, z: 20 },
    amenityRadius: 30
  });
  source.completeMission({ id: 'saved-mission', reward: 50, narrativeProgressDelta: 1 });
  source.unlockEastDistrict();

  const target = new EconomySystem({ eastDistrictUnlockCost: 500 });
  const restored = target.restore(source.serialize());

  assert.equal(restored.treasury, source.treasury);
  assert.equal(restored.narrativeProgress, 1);
  assert.equal(restored.buildings.some(building => building.id === 'saved-building'), true);
  assert.equal(restored.completedMissions.some(mission => mission.id === 'saved-mission'), true);
  assert.equal(target.isDistrictUnlocked(DISTRICT_IDS.EAST_CYBER_METROPOLIS), true);
  assert.throws(() => target.restore({ version: 99 }), /Unsupported economy state version/);
});
