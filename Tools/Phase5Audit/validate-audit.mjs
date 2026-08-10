import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const audit = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'docs/port_evidence/phase5/exit-audit.json'), 'utf8'));
const telemetry = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'docs/port_evidence/phase5/vehicle-telemetry.json'), 'utf8'));
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

requireCondition(audit.schemaVersion === 1 && audit.phase === 5 && audit.status === 'complete', 'Phase 5 audit header is invalid');
requireCondition(audit.referenceRevision === '44a286a74557adfe4fabd3a6e16b9006079eba32', 'Reference revision drifted');
requireCondition(audit.godotVersion === '4.6.stable.mono.official.89cea1439', 'Godot version drifted');
requireCondition(audit.lastVerified?.browserTests === 391 && audit.lastVerified?.domainTests === 255, 'Test baselines drifted');
requireCondition(JSON.stringify(audit.lastVerified?.successfulHeadlessAssertions) === JSON.stringify([134, 134, 138]), 'Headless scenario baselines drifted');
requireCondition(JSON.stringify(audit.lastVerified?.phase5Assertions) === JSON.stringify({
  sessionRuntime: 12,
  gameplayCamera: 17,
  pedestrianController: 11,
  vehiclePhysicsSpike: 7,
  vehicleProfilesPossession: 19,
  exit: 15
}), 'Phase 5 assertion groups drifted');
requireCondition(audit.lastVerified?.soakCycles === 50, 'Phase 5 soak must retain 50 cycles');

const requirements = Array.isArray(audit.requirements) ? audit.requirements : [];
const exitGates = Array.isArray(audit.exitGates) ? audit.exitGates : [];
exactIds(requirements, ['5.1', '5.2', '5.3', '5.4', '5.5', '5.6', '5.7', '5.8'], 'requirement');
exactIds(exitGates, [
  'ownership-soak',
  'transition-compensation',
  'vehicle-telemetry-handling',
  'weather-grip-restoration',
  'recovery-traversal-exit-hijack-ejection'
], 'exit gate');
validateEvidence(requirements, 'requirement');
validateEvidence(exitGates, 'exit gate');
requireCondition(audit.deferredBoundaries?.length === 3, 'Phase 5 must retain exactly three later-phase boundaries');
for (const boundary of audit.deferredBoundaries ?? []) {
  requireCondition(Boolean(boundary.owner) && Boolean(boundary.reason), 'Every deferred boundary needs owner and reason');
  requireCondition(boundary.phases?.every(phase => Number.isInteger(phase) && phase > 5), `${boundary.owner}: deferred phases must be later than Phase 5`);
}

requireCondition(telemetry.schemaVersion === 1 && telemetry.phase === 5, 'Vehicle telemetry header is invalid');
requireCondition(telemetry.selectedBranch === 'CustomRaycastRigidBody', 'Vehicle telemetry does not use ADR 0001 branch');
requireCondition(telemetry.physicsTicksPerSecond === 120, 'Vehicle telemetry physics cadence drifted');
exactIds(telemetry.profiles ?? [], ['SEDAN', 'SPORTS', 'BUS', 'TRUCK', 'POLICE', 'MOTORBIKE'], 'profile');
for (const profile of telemetry.profiles ?? []) {
  requireCondition(Number.isFinite(profile.measuredSpeedMps) && profile.measuredSpeedMps > 0, `${profile.id}: measured speed is invalid`);
  requireCondition(profile.measuredSpeedMps <= profile.maxForwardSpeedMps, `${profile.id}: speed exceeds canonical cap`);
  for (const criterion of ['response', 'stability', 'differentiation']) {
    requireCondition(profile[criterion] === 'accepted', `${profile.id}: ${criterion} is not accepted`);
  }
}
requireCondition(telemetry.weather?.clearGrip === 1 && telemetry.weather?.rainGrip === 0.48 && telemetry.weather?.restoration === 'accepted', 'Rain-to-clear grip evidence drifted');
requireCondition(Object.values(telemetry.traversal ?? {}).every(value => value === 'accepted'), 'Traversal/recovery evidence is incomplete');
requireCondition(telemetry.subjectiveReview?.status === 'accepted'
  && Object.values(telemetry.subjectiveReview?.criteria ?? {}).every(value => value === 'accepted'), 'Phase 5 handling rubric is incomplete');

const integration = fs.readFileSync(path.join(repositoryRoot, 'godot/MetroPulse.Godot/Scripts/Diagnostics/IntegrationTestRunner.cs'), 'utf8');
for (const token of ['phase5.exit.passed', 'soakCycles', 'VehicleImpactDecision', 'InteractionPriorities.VehicleHijack', 'for (int cycle = 0; cycle < cycles']) {
  requireCondition(integration.includes(token), `Integration exit coverage is missing ${token}`);
}
const handoffs = fs.readdirSync(path.join(repositoryRoot, 'docs/port_handoffs')).filter(name => name.startsWith('phase-5-') && name.endsWith('.md'));
requireCondition(handoffs.length === 6, 'Phase 5 must retain five implementation handoffs and one exit handoff');
const plan = fs.readFileSync(path.join(repositoryRoot, 'docs/GODOT_4_6_CSHARP_PORT_PLAN.md'), 'utf8');
requireCondition(plan.includes('Phase 5 complete as of 2026-08-09'), 'Port plan must declare Phase 5 complete');
const verify = fs.readFileSync(path.join(repositoryRoot, 'godot/scripts/verify.sh'), 'utf8');
requireCondition(verify.includes('Phase5Audit/validate-audit.mjs'), 'Native verifier is missing the Phase 5 audit');
const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
requireCondition(workflow.includes('npm run godot:phase5:audit'), 'CI is missing the Phase 5 audit');

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, requirements: requirements.length, exitGates: exitGates.length, profiles: telemetry.profiles.length, soakCycles: audit.lastVerified.soakCycles, handoffs: handoffs.length }, null, 2));
}
