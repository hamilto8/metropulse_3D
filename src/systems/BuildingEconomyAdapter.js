/**
 * Converts renderer/world building objects into the stable, renderer-agnostic
 * contract consumed by EconomySystem. Keeping this translation in one place
 * prevents the editor and the authored skyline from drifting apart.
 */

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.max(0, Math.round(finiteNumber(value, fallback)));
}

function getWorldPosition(building) {
  const source = building?.plot || building?.group?.position;
  if (!Number.isFinite(source?.x) || !Number.isFinite(source?.z)) return undefined;
  return { x: source.x, z: source.z };
}

function getFinancialRates(building, spec, { fallbackIncomePerMinute }) {
  const authoredNet = finiteNumber(
    spec.incomePerMinute,
    fallbackIncomePerMinute
  );
  const explicitRevenue = spec.revenuePerMinute ?? spec.grossIncomePerMinute;
  const explicitUpkeep = spec.upkeepPerMinute ?? spec.operatingCostPerMinute;

  return {
    grossIncomeRate: nonNegative(
      explicitRevenue ?? Math.max(0, authoredNet)
    ) / 60,
    operatingCostRate: nonNegative(
      explicitUpkeep ?? Math.max(0, -authoredNet)
    ) / 60
  };
}

const DEFAULT_SERVICE_REACH = Object.freeze({
  power: 180,
  water: 160,
  fire: 140
});

function serviceReach(spec, service, capacity) {
  if (capacity <= 0) return 0;
  return nonNegative(
    spec[`${service}Reach`] ?? spec[`${service}Radius`] ?? spec.serviceReach,
    DEFAULT_SERVICE_REACH[service]
  );
}

export function createBuildingEconomyRecord(building, {
  spec = building?.spec || {},
  id,
  fallbackIncomePerMinute = 1_200,
  fallbackEmployees,
  fallbackValue
} = {}) {
  if (!building || typeof building !== 'object') {
    throw new TypeError('building must be an object');
  }

  const recordId = id || building.economyId || building.id;
  if (typeof recordId !== 'string' || recordId.trim() === '') {
    throw new TypeError('an economy building id is required');
  }

  const amenityRadius = nonNegative(spec.amenityRadius);
  const happinessModifier = finiteNumber(
    spec.happiness ?? spec.happinessModifier,
    0
  );
  const population = nonNegativeInteger(
    spec.residents ?? spec.population ?? building.residents
  );
  const employees = nonNegativeInteger(
    spec.employees ?? building.employees,
    finiteNumber(fallbackEmployees, 0)
  );
  const { grossIncomeRate, operatingCostRate } = getFinancialRates(
    building,
    spec,
    { fallbackIncomePerMinute }
  );

  return {
    id: recordId.trim(),
    name: building.name || spec.name || recordId,
    kind: spec.category || spec.generatorType || building.businessType || building.type || 'COMMERCIAL',
    value: nonNegative(
      spec.value ?? spec.cost ?? building.value,
      finiteNumber(fallbackValue, 0)
    ),
    employees,
    jobCapacity: nonNegativeInteger(spec.jobCapacity ?? spec.jobs, employees),
    population,
    housingCapacity: nonNegativeInteger(spec.housingCapacity, population),
    status: building.status || spec.status || 'Operational',
    operational: !building.isDestroyed,
    // passiveIncomeRate remains as a compatibility alias for older saves and
    // callers; EconomySystem uses the explicit gross/cost fields.
    passiveIncomeRate: grossIncomeRate,
    grossIncomeRate,
    operatingCostRate,
    happinessModifier,
    landValueModifier: finiteNumber(
      spec.landValueModifier,
      happinessModifier * 0.6 + (amenityRadius > 0 ? 3 : 0)
    ),
    position: getWorldPosition(building),
    amenityRadius,
    services: {
      power: {
        capacity: nonNegative(spec.powerSupply),
        reach: serviceReach(spec, 'power', nonNegative(spec.powerSupply)),
        demand: nonNegative(spec.powerDemand)
      },
      water: {
        capacity: nonNegative(spec.waterSupply),
        reach: serviceReach(spec, 'water', nonNegative(spec.waterSupply)),
        demand: nonNegative(spec.waterDemand)
      },
      fire: {
        capacity: nonNegative(spec.fireCoverage),
        reach: serviceReach(spec, 'fire', nonNegative(spec.fireCoverage)),
        demand: nonNegative(
          spec.fireDemand,
          Math.ceil((population + employees) / 180)
        )
      }
    }
  };
}

export default createBuildingEconomyRecord;
