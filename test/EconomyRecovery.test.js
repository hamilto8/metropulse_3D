import test from 'node:test';
import assert from 'node:assert/strict';

import { EconomySystem } from '../src/systems/EconomySystem.js';
import { AlertService } from '../src/alerts/AlertService.js';
import { EconomyAlertAdapter } from '../src/systems/EconomyAlertAdapter.js';
import {
  calculateBoundedFine,
  ECONOMY_BALANCE,
  FISCAL_STATES
} from '../src/systems/EconomyBalance.js';

test('fiscal states expose deterministic runway, insolvency, assistance, and recovery exit rules', () => {
  const economy = new EconomySystem({ initialTreasury: 10, passiveIncomeRate: 0 });
  economy.registerBuilding({ id: 'cost-center', operatingCostRate: 1 });

  assert.equal(economy.snapshot().fiscalStatus, FISCAL_STATES.DEFICIT);
  assert.equal(economy.snapshot().fiscal.runwayMinutes, 1 / 6);
  economy.update(10);
  assert.equal(economy.snapshot().fiscalStatus, FISCAL_STATES.INSOLVENT);
  assert.equal(economy.snapshot().fiscal.assistanceEligible, true);

  const assistance = economy.requestEmergencyAssistance();
  assert.equal(assistance.granted, true);
  assert.equal(assistance.amount, ECONOMY_BALANCE.fiscal.emergencyGrant);
  assert.equal(economy.snapshot().fiscalStatus, FISCAL_STATES.RECOVERY);
  assert.equal(economy.snapshot().fiscal.restrictionsActive, true);

  const optionalSpend = economy.evaluateSpending(2_500, { source: 'zoning' });
  assert.equal(optionalSpend.allowed, false);
  assert.equal(optionalSpend.code, 'RECOVERY_RESTRICTION');
  assert.equal(economy.spend(2_500, { source: 'zoning' }), false);
  assert.equal(economy.spend(1_000, { source: 'incident-response' }), true);

  economy.removeBuilding('cost-center');
  assert.equal(economy.snapshot().fiscalStatus, FISCAL_STATES.STABLE);
  assert.equal(economy.snapshot().fiscal.completedRecoveries, 1);
});

test('pre-spend policy preserves a reserve during deficits but permits cash-positive recovery investments', () => {
  const economy = new EconomySystem({ initialTreasury: 30_000 });
  economy.registerBuilding({ id: 'upkeep', operatingCostRate: 1 });

  const risky = economy.evaluateSpending(10_000, { source: 'zoning' });
  assert.equal(risky.allowed, false);
  assert.equal(risky.code, 'RESERVE_AT_RISK');
  assert.match(risky.remedy, /25,000/);

  economy.update(30_000);
  assert.equal(economy.treasury, 0);
  economy.requestEmergencyAssistance();
  const investment = economy.evaluateSpending(50_000, {
    source: 'building-placement',
    spec: { incomePerMinute: 120 }
  });
  assert.equal(investment.allowed, true);
  assert.equal(investment.recoveryInvestment, true);
});

test('emergency assistance remains reclaimable only after a negative city exhausts the prior grant', () => {
  const economy = new EconomySystem({ initialTreasury: 1 });
  economy.registerBuilding({ id: 'upkeep', operatingCostRate: 10 });
  economy.update(1);

  assert.equal(economy.requestEmergencyAssistance().granted, true);
  assert.equal(economy.requestEmergencyAssistance().granted, false);
  economy.update(20_000);
  assert.equal(economy.treasury, 0);
  assert.equal(economy.requestEmergencyAssistance().granted, true);
  assert.equal(economy.snapshot().fiscal.assistanceClaims, 2);
});

test('bounded fines are proportional, capped, itemized, and cannot create insolvency', () => {
  assert.equal(calculateBoundedFine(60_000, 500_000), 25_000);
  assert.equal(calculateBoundedFine(60_000, 20_000), 2_000);
  const economy = new EconomySystem({ initialTreasury: 20_000 });
  const receipt = economy.applyFine(60_000, { referenceId: 'traffic-violation' });
  assert.deepEqual(receipt, { requested: 60_000, charged: 2_000, capped: true });
  assert.equal(economy.treasury, 18_000);
});

test('recovery contract persists and restores without duplicating assistance', () => {
  const economy = new EconomySystem({ initialTreasury: 1 });
  economy.registerBuilding({ id: 'upkeep', operatingCostRate: 1 });
  economy.update(1);
  economy.requestEmergencyAssistance();
  const saved = economy.serialize();

  const restored = new EconomySystem();
  restored.restore(saved);
  assert.equal(restored.snapshot().fiscalStatus, FISCAL_STATES.RECOVERY);
  assert.equal(restored.snapshot().fiscal.assistanceClaims, 1);
  assert.equal(restored.treasury, ECONOMY_BALANCE.fiscal.emergencyGrant);
  assert.equal(restored.requestEmergencyAssistance().granted, false);
});

test('fiscal stress publishes one structured alert and resolves it after recovery', () => {
  const economy = new EconomySystem({ initialTreasury: 5 });
  const alerts = new AlertService();
  const adapter = new EconomyAlertAdapter({ economySystem: economy, alertService: alerts });
  economy.registerBuilding({ id: 'upkeep', operatingCostRate: 1 });

  let warning = alerts.snapshot().active.find(alert => alert.dedupeKey === 'economy:fiscal-recovery');
  assert.equal(warning.type, 'ECONOMY');
  assert.equal(warning.severity, 'WARNING');
  assert.match(warning.cause, /runway/);

  economy.update(5);
  warning = alerts.snapshot().active.find(alert => alert.dedupeKey === 'economy:fiscal-recovery');
  assert.equal(warning.severity, 'CRITICAL');
  assert.match(warning.recommendation, /stabilization grant/);
  economy.requestEmergencyAssistance();
  assert.equal(alerts.snapshot().active.filter(alert => alert.dedupeKey === 'economy:fiscal-recovery').length, 1);
  economy.removeBuilding('upkeep');
  assert.equal(alerts.snapshot().active.some(alert => alert.dedupeKey === 'economy:fiscal-recovery'), false);
  adapter.dispose();
});
