import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const auditPath = path.join(repositoryRoot, 'docs/port_evidence/phase6/exit-audit.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

function exactIds(entries, expected, label) {
  const actual = entries.map(entry => entry.id).sort();
  requireCondition(new Set(actual).size === actual.length, `${label} contains duplicate IDs`);
  requireCondition(JSON.stringify(actual) === JSON.stringify([...expected].sort()), `${label} IDs are incomplete`);
}

function validateEvidence(entries, label) {
  for (const entry of entries) {
    requireCondition(entry.status === 'complete', `${label} ${entry.id} is not complete`);
    if (label === 'requirement') requireCondition(Boolean(entry.owner), `${label} ${entry.id} has no owner`);
    requireCondition(Array.isArray(entry.evidence) && entry.evidence.length > 0, `${label} ${entry.id} has no evidence`);
    for (const evidence of entry.evidence ?? []) {
      requireCondition(fs.existsSync(path.join(repositoryRoot, evidence)), `${label} ${entry.id} is missing ${evidence}`);
    }
  }
}

requireCondition(audit.schemaVersion === 1 && audit.phase === 6 && audit.status === 'complete', 'Phase 6 audit header is invalid');
requireCondition(audit.referenceRevision === '44a286a74557adfe4fabd3a6e16b9006079eba32', 'Reference revision drifted');
requireCondition(audit.godotVersion === '4.6.stable.mono.official.89cea1439', 'Godot version drifted');
requireCondition(audit.lastVerified?.browserTests === 391 && audit.lastVerified?.domainTests === 280, 'Test baselines drifted');
requireCondition(JSON.stringify(audit.lastVerified?.successfulHeadlessAssertions) === JSON.stringify([155, 155, 159]), 'Headless scenario baselines drifted');

const soak = audit.soak ?? {};
requireCondition(soak.durationSeconds === 1800 && soak.stepSeconds === 0.1 && soak.steps === 18000, 'Soak duration or cadence drifted');
requireCondition(soak.movingVehicles?.minimum === 48 && soak.movingVehicles?.maximum === 48, 'Moving floor was not stable');
requireCondition(soak.parkedVehicles?.minimum === 12 && soak.parkedVehicles?.maximum === 12, 'Parked inventory was not stable');
requireCondition(soak.citizens?.minimum === 60 && soak.citizens?.maximum === 60, 'Citizen floor was not stable');
requireCondition(soak.trafficCulls === 10 && soak.pedestrianCulls === 15 && soak.possessionCycles === 12, 'Lifecycle stress counts drifted');
requireCondition(soak.hitAndRunCycles === 10 && soak.enforcementCycles === 10, 'Response stress counts drifted');
requireCondition(soak.finalActiveResponses === 0 && soak.finalActiveKnockdowns === 0, 'Soak cleanup is incomplete');

const query = audit.queryProfile ?? {};
requireCondition(query.routineTrafficMaximumCandidates === 6 && query.routineTrafficMaximumCandidates < query.trafficPopulation, 'Traffic query profile is not bounded');
requireCondition(query.routinePedestrianMaximumCandidates === 4 && query.routinePedestrianMaximumCandidates < query.pedestrianPopulation, 'Pedestrian query profile is not bounded');
requireCondition(query.initialEnforcementMaximumCandidates === 35 && query.initialEnforcementMaximumCandidates < query.trafficPopulation, 'Enforcement query profile is not bounded');

const requirements = Array.isArray(audit.requirements) ? audit.requirements : [];
const exitGates = Array.isArray(audit.exitGates) ? audit.exitGates : [];
exactIds(requirements, ['6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8', '6.9'], 'requirement');
exactIds(exitGates, ['lane-corridors', 'population-lifecycle', 'behavior-reference-metrics', 'bounded-routine-queries', 'thirty-minute-soak'], 'exit gate');
validateEvidence(requirements, 'requirement');
validateEvidence(exitGates, 'exit gate');
requireCondition(audit.remainingPlaceholders?.length === 4, 'Phase 6 must retain exactly four later-phase placeholders');
for (const placeholder of audit.remainingPlaceholders ?? []) {
  requireCondition(Boolean(placeholder.owner) && Boolean(placeholder.reason), 'Every placeholder needs an owner and reason');
  requireCondition(Number.isInteger(placeholder.phase) && placeholder.phase > 6, `${placeholder.owner}: placeholder phase must be later than Phase 6`);
}

const soakTest = fs.readFileSync(path.join(repositoryRoot, 'godot/MetroPulse.Domain.Tests/Simulation/Phase6LivingCitySoakTests.cs'), 'utf8');
for (const token of ['SoakSteps = 18_000', 'StepSeconds = 0.1', 'trafficCulls', 'pedestrianCulls', 'possessionCycles', 'hitAndRunCycles', 'enforcementCycles', 'AssertPopulationInvariants']) {
  requireCondition(soakTest.includes(token), `Living-city soak coverage is missing ${token}`);
}
const traffic = fs.readFileSync(path.join(repositoryRoot, 'godot/MetroPulse.Domain/Traffic/TrafficPopulationSimulation.cs'), 'utf8');
for (const token of ['SpatialHashGrid<Agent>', 'nextCorridor', 'DispatchOrUpdateEnforcement', 'EnsurePopulationFloor']) {
  requireCondition(traffic.includes(token), `Traffic lifecycle/query coverage is missing ${token}`);
}
const handoffs = fs.readdirSync(path.join(repositoryRoot, 'docs/port_handoffs')).filter(name => name.startsWith('phase-6-') && name.endsWith('.md'));
requireCondition(handoffs.length === 5, 'Phase 6 must retain four implementation handoffs and one exit handoff');
const plan = fs.readFileSync(path.join(repositoryRoot, 'docs/GODOT_4_6_CSHARP_PORT_PLAN.md'), 'utf8');
requireCondition(plan.includes('Phase 6 complete as of 2026-08-11'), 'Port plan must declare Phase 6 complete');
const verify = fs.readFileSync(path.join(repositoryRoot, 'godot/scripts/verify.sh'), 'utf8');
requireCondition(verify.includes('Phase6Audit/validate-audit.mjs'), 'Native verifier is missing the Phase 6 audit');
const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
requireCondition(workflow.includes('npm run godot:phase6:audit'), 'CI is missing the Phase 6 audit');

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    requirements: requirements.length,
    exitGates: exitGates.length,
    soakSteps: soak.steps,
    handoffs: handoffs.length,
  }, null, 2));
}
