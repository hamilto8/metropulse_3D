/**
 * P4.5 economy tuning and recovery rules.
 *
 * Values in this module are expressed in Capital or simulation seconds. It is
 * the one balance authority shared by runtime systems and deterministic
 * scenario tests; renderer and UI code must consume the resulting snapshots.
 */

export const FISCAL_STATES = Object.freeze({
  STABLE: 'STABLE',
  DEFICIT: 'DEFICIT',
  INSOLVENT: 'INSOLVENT',
  RECOVERY: 'RECOVERY'
});

export const SPENDING_CATEGORIES = Object.freeze({
  ESSENTIAL: 'ESSENTIAL',
  RECOVERY: 'RECOVERY',
  DISCRETIONARY: 'DISCRETIONARY'
});

export const ECONOMY_BALANCE = deepFreeze({
  startingTreasury: 650_000,
  baseRevenuePerSecond: 8,
  fiscal: {
    reserveFloor: 25_000,
    warningRunwayMinutes: 10,
    emergencyGrant: 100_000
  },
  construction: {
    zoningCost: 2_500,
    defaultSalvageRate: 0.5,
    starterPaybackMinutes: { min: 45, max: 200 }
  },
  missions: {
    rewardScale: 100,
    targetRewardRange: { min: 30_000, max: 150_000 }
  },
  incidents: {
    cleanupCostPerSeverity: 350,
    repairCostPerSeverity: 850
  },
  policies: {
    freightPriorityCostPerSecond: 2
  },
  fines: {
    maximum: 25_000,
    treasuryShare: 0.1
  },
  progression: {
    eastDistrictUnlockCost: 1_000_000
  },
  sessionTargets: {
    15: { label: 'First investment', minimumTreasury: 100_000, minimumAssets: 1 },
    30: { label: 'Second decision', minimumTreasury: 100_000, minimumAssets: 2 },
    60: { label: 'Incident recovery', minimumTreasury: 150_000, minimumAssets: 2 },
    120: { label: 'Sustainable growth', minimumTreasury: 200_000, minimumAssets: 4 }
  }
});

const ESSENTIAL_SOURCES = new Set([
  'cleanup',
  'fine',
  'incident-response',
  'mission-outcome',
  'repair',
  'service-response'
]);

const RECOVERY_SOURCES = new Set([
  'building-salvage',
  'emergency-assistance',
  'mission',
  'recovery-contract'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function getSpendingCategory(source = 'manual') {
  const normalized = String(source || 'manual').trim().toLowerCase();
  if (ESSENTIAL_SOURCES.has(normalized) || normalized.includes('repair') || normalized.includes('cleanup')) {
    return SPENDING_CATEGORIES.ESSENTIAL;
  }
  if (RECOVERY_SOURCES.has(normalized) || normalized.includes('salvage') || normalized.includes('recovery')) {
    return SPENDING_CATEGORIES.RECOVERY;
  }
  return SPENDING_CATEGORIES.DISCRETIONARY;
}

export function getRunwayMinutes(treasury, netRate) {
  const cash = Math.max(0, finite(treasury));
  const rate = finite(netRate);
  if (rate >= 0) return null;
  return cash / -rate / 60;
}

export function getFiscalState({ treasury, netRate, recoveryActive = false } = {}) {
  const cash = Math.max(0, finite(treasury));
  const rate = finite(netRate);
  if (recoveryActive) return FISCAL_STATES.RECOVERY;
  if (cash <= 0 && rate < 0) return FISCAL_STATES.INSOLVENT;
  if (rate < 0) return FISCAL_STATES.DEFICIT;
  return FISCAL_STATES.STABLE;
}

function getProjectedRateDelta(context = {}) {
  if (Number.isFinite(context.projectedNetRateDelta)) return context.projectedNetRateDelta;
  if (Number.isFinite(context.recurringCostRate)) return -Math.max(0, context.recurringCostRate);
  const spec = context.spec;
  if (!spec || typeof spec !== 'object') return 0;
  const authoredNet = finite(spec.incomePerMinute);
  const gross = finite(spec.revenuePerMinute ?? spec.grossIncomePerMinute, Math.max(0, authoredNet));
  const upkeep = finite(spec.operatingCostPerMinute ?? spec.upkeepPerMinute, Math.max(0, -authoredNet));
  return (gross - upkeep) / 60;
}

/**
 * Produces the canonical, immutable pre-debit decision used by construction,
 * policies, districts, and direct EconomySystem spends.
 */
export function evaluateSpendingPolicy({
  treasury,
  netRate,
  recoveryActive = false,
  amount,
  source = 'manual',
  context = {},
  balance = ECONOMY_BALANCE
} = {}) {
  const cash = Math.max(0, finite(treasury));
  const debit = Math.max(0, finite(amount));
  const category = context.category || getSpendingCategory(source);
  const projectedNetRate = finite(netRate) + getProjectedRateDelta(context);
  const remainingTreasury = cash - debit;
  const state = getFiscalState({ treasury: cash, netRate, recoveryActive });
  const recoveryInvestment = category === SPENDING_CATEGORIES.DISCRETIONARY
    && projectedNetRate >= 0
    && getProjectedRateDelta(context) > 0;
  let allowed = true;
  let code = 'ALLOWED';
  let reason = 'Capital is available and the purchase preserves a recovery path.';
  let remedy = null;

  if (debit > cash) {
    allowed = false;
    code = 'INSUFFICIENT_FUNDS';
    reason = `This action requires $${Math.round(debit).toLocaleString()}, but only $${Math.floor(cash).toLocaleString()} is available.`;
    remedy = 'Complete a contract, salvage an optional asset, or claim emergency assistance when insolvent.';
  } else if (
    category === SPENDING_CATEGORIES.DISCRETIONARY
    && [FISCAL_STATES.INSOLVENT, FISCAL_STATES.RECOVERY].includes(state)
    && !recoveryInvestment
  ) {
    allowed = false;
    code = 'RECOVERY_RESTRICTION';
    reason = 'Optional expansion is paused while the city is under fiscal recovery restrictions.';
    remedy = 'Restore non-negative cashflow and rebuild the emergency reserve first.';
  } else if (
    category === SPENDING_CATEGORIES.DISCRETIONARY
    && projectedNetRate < 0
    && remainingTreasury < balance.fiscal.reserveFloor
  ) {
    allowed = false;
    code = 'RESERVE_AT_RISK';
    reason = `This action would leave $${Math.max(0, Math.floor(remainingTreasury)).toLocaleString()} while the city continues losing Capital.`;
    remedy = `Keep at least $${balance.fiscal.reserveFloor.toLocaleString()} in reserve or choose a cash-positive investment.`;
  }

  const runwayMinutes = getRunwayMinutes(Math.max(0, remainingTreasury), projectedNetRate);
  const warning = allowed && runwayMinutes !== null && runwayMinutes < balance.fiscal.warningRunwayMinutes
    ? `Warning: projected reserves last about ${Math.max(1, Math.ceil(runwayMinutes))} minute${Math.ceil(runwayMinutes) === 1 ? '' : 's'} at the current cashflow.`
    : null;

  return deepFreeze({
    allowed,
    code,
    reason,
    remedy,
    category,
    state,
    amount: debit,
    remainingTreasury,
    projectedNetRate,
    runwayMinutes,
    warning,
    recoveryInvestment
  });
}

/** Fines are consequences, not run-ending drains. */
export function calculateBoundedFine(requestedAmount, treasury, balance = ECONOMY_BALANCE) {
  const requested = Math.max(0, finite(requestedAmount));
  const cash = Math.max(0, finite(treasury));
  return Math.min(
    requested,
    balance.fines.maximum,
    Math.floor(cash * balance.fines.treasuryShare)
  );
}
