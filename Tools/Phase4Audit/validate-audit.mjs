import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const audit = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'docs/port_evidence/phase4/exit-audit.json'), 'utf8'));
const screenshots = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'docs/port_evidence/phase4/screenshot-manifest.json'), 'utf8'));
const performance = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'docs/port_evidence/phase4/world-performance.json'), 'utf8'));
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

requireCondition(audit.schemaVersion === 1 && audit.phase === 4 && audit.status === 'complete', 'Phase 4 audit header is invalid');
requireCondition(audit.referenceRevision === '44a286a74557adfe4fabd3a6e16b9006079eba32', 'Reference revision drifted');
requireCondition(audit.godotVersion === '4.6.stable.mono.official.89cea1439', 'Godot version drifted');
requireCondition(audit.lastVerified?.browserTests === 391 && audit.lastVerified?.domainTests === 232, 'Test baselines drifted');
requireCondition(JSON.stringify(audit.lastVerified?.successfulHeadlessAssertions) === JSON.stringify([84, 84, 88]), 'Headless scenario baselines drifted');
requireCondition(JSON.stringify(audit.lastVerified?.phase4Assertions) === JSON.stringify({ world: 12, presentation: 15, exit: 5 }), 'Phase 4 assertion groups drifted');

const requirements = Array.isArray(audit.requirements) ? audit.requirements : [];
const exitGates = Array.isArray(audit.exitGates) ? audit.exitGates : [];
exactIds(requirements, ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8', '4.9', '4.10'], 'requirement');
exactIds(exitGates, ['traversal-camera', 'query-parity', 'collider-alignment', 'visual-signoff', 'lifecycle-baseline'], 'exit gate');
validateEvidence(requirements, 'requirement');
validateEvidence(exitGates, 'exit gate');
requireCondition(audit.deferredBoundaries?.length === 3, 'Phase 4 must retain exactly three later-phase boundaries');
for (const boundary of audit.deferredBoundaries ?? []) {
  requireCondition(Boolean(boundary.owner) && Boolean(boundary.reason), 'Every deferred boundary needs owner and reason');
  requireCondition(boundary.phases?.every(phase => Number.isInteger(phase) && phase > 4), `${boundary.owner}: deferred phases must be later than Phase 4`);
}

const expectedScreenshots = [
  ['management-day-clear', 13, 'clear'],
  ['management-dusk-rain', 18.5, 'rain'],
  ['management-night-clear', 23, 'clear']
];
requireCondition(screenshots.scenarios?.length === expectedScreenshots.length, 'Screenshot pair count drifted');
for (const [id, hour, weather] of expectedScreenshots) {
  const scenario = screenshots.scenarios?.find(item => item.id === id);
  requireCondition(scenario?.hour === hour && scenario?.weather === weather && scenario?.seed === 424242, `${id}: fixed capture configuration drifted`);
  requireCondition(scenario?.width === 1280 && scenario?.height === 720, `${id}: capture dimensions drifted`);
  requireCondition(['geometry', 'palette', 'lighting', 'readability'].every(key => scenario?.signoff?.[key] === 'accepted'), `${id}: visual signoff is incomplete`);
  for (const key of ['reference', 'godot']) requireCondition(fs.existsSync(path.join(repositoryRoot, scenario?.[key] ?? 'missing')), `${id}: ${key} image is missing`);
  if (scenario?.godot && fs.existsSync(path.join(repositoryRoot, scenario.godot))) {
    const hash = createHash('sha256').update(fs.readFileSync(path.join(repositoryRoot, scenario.godot))).digest('hex');
    requireCondition(hash === scenario.sha256, `${id}: Godot image hash drifted`);
  }
}

const chunks = Object.values(performance.chunks ?? {});
for (const metric of ['objects', 'colliders', 'instances', 'segments']) {
  requireCondition(chunks.reduce((sum, chunk) => sum + chunk[metric], 0) === performance.totals?.[metric], `${metric}: chunk total drifted`);
}
for (const metric of ['objects', 'colliders', 'multiMeshGroups', 'cachedMeshes', 'cachedMaterials', 'cachedShapes']) {
  requireCondition(performance.totals?.[metric] <= performance.budgets?.[metric], `${metric}: Phase 4 resource budget exceeded`);
}
requireCondition(Object.values(performance.afterShutdown ?? {}).every(value => value === 0), 'World shutdown does not return to baseline');

const integration = fs.readFileSync(path.join(repositoryRoot, 'godot/MetroPulse.Godot/Scripts/Diagnostics/IntegrationTestRunner.cs'), 'utf8');
for (const token of ['phase4.world.passed', 'phase4.presentation.passed', 'phase4.exit.passed', 'StableId', 'IntersectShape']) {
  requireCondition(integration.includes(token), `Integration exit coverage is missing ${token}`);
}
const handoffs = fs.readdirSync(path.join(repositoryRoot, 'docs/port_handoffs')).filter(name => name.startsWith('phase-4-') && name.endsWith('.md'));
requireCondition(handoffs.length === 4, 'Phase 4 must retain three implementation handoffs and one exit handoff');
const plan = fs.readFileSync(path.join(repositoryRoot, 'docs/GODOT_4_6_CSHARP_PORT_PLAN.md'), 'utf8');
requireCondition(plan.includes('Phase 4 complete as of 2026-08-09'), 'Port plan must declare Phase 4 complete');
const verify = fs.readFileSync(path.join(repositoryRoot, 'godot/scripts/verify.sh'), 'utf8');
for (const token of ['Phase4Audit/validate-audit.mjs', 'capture-landmarks.mjs', 'build-screenshot-manifest.mjs']) {
  requireCondition(verify.includes(token), `Native verifier is missing ${token}`);
}
const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
requireCondition(workflow.includes('npm run godot:phase4:audit'), 'CI is missing the Phase 4 audit');

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, requirements: requirements.length, exitGates: exitGates.length, screenshotPairs: screenshots.scenarios.length, chunks: chunks.length, handoffs: handoffs.length }, null, 2));
}
