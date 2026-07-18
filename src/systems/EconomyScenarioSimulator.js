import { EconomySystem } from './EconomySystem.js';
import { ECONOMY_BALANCE } from './EconomyBalance.js';

export const ECONOMY_SCENARIO_ACTIONS = Object.freeze({
  BUILD: 'BUILD',
  FINE: 'FINE',
  MISSION: 'MISSION',
  SPEND: 'SPEND'
});

export const BALANCED_SESSION_EVENTS = Object.freeze([
  Object.freeze({ minute: 5, type: 'BUILD', id: 'CYBERCAFE', cost: 200_000, incomePerMinute: 2_400 }),
  Object.freeze({ minute: 10, type: 'MISSION', id: 'session-contract-1', reward: 45_000 }),
  Object.freeze({ minute: 25, type: 'BUILD', id: 'METRO_LOFTS', cost: 350_000, incomePerMinute: 1_900 }),
  Object.freeze({ minute: 30, type: 'MISSION', id: 'session-contract-2', reward: 52_000 }),
  Object.freeze({ minute: 45, type: 'SPEND', id: 'incident-response-1', amount: 6_000, source: 'incident-response' }),
  Object.freeze({ minute: 50, type: 'MISSION', id: 'session-contract-3', reward: 68_000 }),
  Object.freeze({ minute: 70, type: 'BUILD', id: 'SOLAR_GRID', cost: 280_000, incomePerMinute: -450 }),
  Object.freeze({ minute: 75, type: 'MISSION', id: 'session-contract-4', reward: 75_000 }),
  Object.freeze({ minute: 90, type: 'MISSION', id: 'session-contract-5', reward: 85_000 }),
  Object.freeze({ minute: 105, type: 'FINE', id: 'session-fine-1', amount: 60_000 }),
  Object.freeze({ minute: 110, type: 'BUILD', id: 'CYBER_FAB', cost: 390_000, incomePerMinute: 6_200 })
]);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function applyEvent(economy, event) {
  switch (event.type) {
    case ECONOMY_SCENARIO_ACTIONS.BUILD: {
      const spec = { id: event.id, incomePerMinute: event.incomePerMinute };
      if (!economy.spend(event.cost, { source: 'building-placement', referenceId: event.id, spec })) {
        throw new Error(`Scenario could not fund ${event.id} at minute ${event.minute}`);
      }
      economy.registerBuilding({
        id: `scenario:${event.id}`,
        grossIncomeRate: Math.max(0, event.incomePerMinute) / 60,
        operatingCostRate: Math.max(0, -event.incomePerMinute) / 60
      });
      break;
    }
    case ECONOMY_SCENARIO_ACTIONS.MISSION:
      economy.completeMission({ id: event.id, reward: event.reward, narrativeProgressDelta: 1 });
      break;
    case ECONOMY_SCENARIO_ACTIONS.FINE:
      economy.applyFine(event.amount, { referenceId: event.id });
      break;
    case ECONOMY_SCENARIO_ACTIONS.SPEND:
      if (!economy.spend(event.amount, { source: event.source, referenceId: event.id })) {
        throw new Error(`Scenario debit ${event.id} was rejected at minute ${event.minute}`);
      }
      break;
    default:
      throw new RangeError(`Unsupported economy scenario action: ${String(event.type)}`);
  }
}

/**
 * Runs ordered player/economy actions against the production EconomySystem.
 * Explicit simulation time and stable ordering make the same scenario exactly
 * reproducible in tests, CI, and future balance tooling.
 */
export function runEconomyScenario({
  durationMinutes,
  events = [],
  initialTreasury = ECONOMY_BALANCE.startingTreasury,
  passiveIncomeRate = ECONOMY_BALANCE.baseRevenuePerSecond
} = {}) {
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
    throw new RangeError('durationMinutes must be a non-negative finite number');
  }
  const normalizedEvents = events.map((event, index) => {
    if (!event || typeof event !== 'object' || !Number.isFinite(event.minute) || event.minute < 0) {
      throw new TypeError(`scenario event ${index} requires a non-negative finite minute`);
    }
    return { ...event, index };
  });
  const ordered = normalizedEvents
    .filter(event => event.minute <= durationMinutes)
    .sort((left, right) => left.minute - right.minute || left.index - right.index);
  const economy = new EconomySystem({ initialTreasury, passiveIncomeRate });
  const transactions = [];
  let elapsedMinutes = 0;

  for (const event of ordered) {
    economy.update((event.minute - elapsedMinutes) * 60);
    applyEvent(economy, event);
    elapsedMinutes = event.minute;
    transactions.push({
      minute: event.minute,
      type: event.type,
      id: event.id,
      treasury: economy.treasury,
      fiscalStatus: economy.snapshot().fiscalStatus
    });
  }
  economy.update((durationMinutes - elapsedMinutes) * 60);
  const snapshot = economy.snapshot();
  return freeze({
    durationMinutes,
    snapshot,
    assetCount: snapshot.buildings.length,
    missionCount: snapshot.completedMissions.length,
    transactions
  });
}

export function runBalancedSession(durationMinutes) {
  return runEconomyScenario({ durationMinutes, events: BALANCED_SESSION_EVENTS });
}

export default runEconomyScenario;
