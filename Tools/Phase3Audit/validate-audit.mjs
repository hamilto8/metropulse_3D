import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const auditPath = path.join(repositoryRoot, 'docs/port_evidence/phase3/exit-audit.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

function requireExactIds(entries, expected, label) {
  const actual = entries.map(entry => entry.id).sort();
  requireCondition(new Set(actual).size === actual.length, `${label} contains duplicate IDs`);
  requireCondition(JSON.stringify(actual) === JSON.stringify([...expected].sort()),
    `${label} must contain exactly ${expected.join(', ')}`);
}

function validateEvidence(entries, label) {
  for (const entry of entries) {
    requireCondition(entry.status === 'complete', `${label} ${entry.id} is not complete`);
    if (label === 'requirement') {
      requireCondition(typeof entry.owner === 'string' && entry.owner.length > 0,
        `${label} ${entry.id} has no authoritative owner`);
    }
    requireCondition(Array.isArray(entry.evidence) && entry.evidence.length > 0,
      `${label} ${entry.id} has no evidence`);
    for (const evidencePath of entry.evidence ?? []) {
      requireCondition(typeof evidencePath === 'string' && evidencePath.length > 0,
        `${label} ${entry.id} has an invalid evidence path`);
      requireCondition(fs.existsSync(path.join(repositoryRoot, evidencePath)),
        `${label} ${entry.id} is missing ${evidencePath}`);
    }
  }
}

requireCondition(audit.schemaVersion === 1, 'schemaVersion must be 1');
requireCondition(audit.phase === 3, 'phase must be 3');
requireCondition(audit.status === 'complete', 'Phase 3 audit status must be complete');
requireCondition(audit.referenceRevision === '44a286a74557adfe4fabd3a6e16b9006079eba32',
  'referenceRevision must remain the frozen Phase 0 revision');
requireCondition(audit.godotVersion === '4.6.stable.mono.official.89cea1439',
  'Godot evidence must remain pinned to 4.6 stable .NET');
requireCondition(audit.lastVerified?.browserTests === 391,
  'Browser verification baseline must remain 391 tests');
requireCondition(audit.lastVerified?.domainTests === 220,
  'Domain verification baseline must remain 220 tests');
requireCondition(JSON.stringify(audit.lastVerified?.successfulHeadlessAssertions) === JSON.stringify([84, 84, 88]),
  'Successful headless assertion baselines must remain 84, 84, and 88');
requireCondition(JSON.stringify(audit.lastVerified?.expectedFailureCodes) === JSON.stringify([
  'IMPORT_CONFIRMATION_REQUIRED',
  'INVALID_SAVE',
  'FUTURE_SAVE_VERSION'
]), 'Expected failure codes must remain stable');

const requirements = Array.isArray(audit.requirements) ? audit.requirements : [];
const exitGates = Array.isArray(audit.exitGates) ? audit.exitGates : [];
requireExactIds(requirements, ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8', '3.9'], 'requirements');
requireExactIds(exitGates, [
  'boot-save-scenarios',
  'settings-bindings-restart',
  'interrupted-slot-rotation',
  'browser-save-validation',
  'readiness-before-input'
], 'exitGates');
validateEvidence(requirements, 'requirement');
validateEvidence(exitGates, 'exit gate');

requireCondition(audit.deferredBoundaries?.length === 3,
  'Phase 3 must retain exactly three later-phase ownership boundaries');
for (const boundary of audit.deferredBoundaries ?? []) {
  requireCondition(typeof boundary.owner === 'string' && boundary.owner.length > 0,
    'Every deferred boundary requires an owner');
  requireCondition(typeof boundary.reason === 'string' && boundary.reason.length > 0,
    `${boundary.owner}: deferred reason is required`);
  requireCondition(Array.isArray(boundary.phases)
    && boundary.phases.length > 0
    && boundary.phases.every(phase => Number.isInteger(phase) && phase > 3),
  `${boundary.owner}: every deferred phase must be later than Phase 3`);
}

const bootContracts = fs.readFileSync(
  path.join(repositoryRoot, 'godot/MetroPulse.Domain/Boot/BootPipeline.cs'), 'utf8');
const composition = fs.readFileSync(
  path.join(repositoryRoot, 'godot/MetroPulse.Godot/Scripts/App/CompositionRoot.cs'), 'utf8');
for (const stage of [
  'CapabilityChecks',
  'SettingsBootstrap',
  'ContentValidation',
  'SaveDiscovery',
  'ActionSelection',
  'SessionConstruction',
  'SaveApplication',
  'FinalReadiness',
  'InteractiveRelease'
]) {
  requireCondition(bootContracts.includes(`public const string ${stage}`),
    `Boot contract is missing ${stage}`);
  requireCondition(composition.includes(`BootStageIds.${stage}`),
    `Composition root does not wire ${stage}`);
}

const integrationScript = fs.readFileSync(
  path.join(repositoryRoot, 'godot/scripts/test-integration.sh'), 'utf8');
for (const token of [
  '--boot-action=NEW_GAME',
  '--boot-action=CONTINUE',
  'BootActionIds.Recover',
  'IMPORT_CONFIRMATION_REQUIRED',
  'INVALID_SAVE',
  'FUTURE_SAVE_VERSION',
  'godot-integration-recovery.log'
]) {
  const source = token === 'BootActionIds.Recover'
    ? fs.readFileSync(path.join(repositoryRoot,
      'godot/MetroPulse.Godot/Scripts/Diagnostics/IntegrationTestRunner.cs'), 'utf8')
    : integrationScript;
  requireCondition(source.includes(token), `Headless exit coverage is missing ${token}`);
}

const runtimeConfiguration = fs.readFileSync(
  path.join(repositoryRoot, 'godot/MetroPulse.Domain/Diagnostics/RuntimeConfiguration.cs'), 'utf8');
requireCondition(runtimeConfiguration.includes('debugOnlyOptionRequested')
  && runtimeConfiguration.includes('disabled in release builds'),
'Release builds must reject debug-only scenario hooks');

const diagnosticContract = fs.readFileSync(
  path.join(repositoryRoot, 'godot/MetroPulse.Domain/Diagnostics/DiagnosticSnapshot.cs'), 'utf8');
for (const field of [
  'DiagnosticRuntimeState',
  'DiagnosticControlledEntity',
  'DiagnosticMissionState',
  'DiagnosticSaveState',
  'DiagnosticCounts',
  'DiagnosticPerformance',
  'FeatureFlags',
  'DiagnosticScenarioMetadata'
]) {
  requireCondition(diagnosticContract.includes(field), `Diagnostics contract is missing ${field}`);
}
requireCondition(!diagnosticContract.includes('ImportSavePath'),
  'Diagnostics must not retain an absolute import path');

const handoffs = fs.readdirSync(path.join(repositoryRoot, 'docs/port_handoffs'))
  .filter(name => name.startsWith('phase-3-') && name.endsWith('.md'));
requireCondition(handoffs.length === 8, 'Phase 3 must retain seven implementation handoffs and one exit handoff');

const plan = fs.readFileSync(path.join(repositoryRoot, 'docs/GODOT_4_6_CSHARP_PORT_PLAN.md'), 'utf8');
requireCondition(plan.includes('**Status:** Complete as of 2026-08-09.'),
  'Port plan must declare Phase 3 complete');

const verifyScript = fs.readFileSync(path.join(repositoryRoot, 'godot/scripts/verify.sh'), 'utf8');
requireCondition(verifyScript.includes('Tools/Phase3Audit/validate-audit.mjs'),
  'Native verification must execute the Phase 3 audit');
const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
requireCondition(workflow.includes('npm run godot:phase3:audit'),
  'CI must execute the Phase 3 audit');

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    requirements: requirements.length,
    exitGates: exitGates.length,
    deferredBoundaries: audit.deferredBoundaries.length,
    handoffs: handoffs.length
  }, null, 2));
}
