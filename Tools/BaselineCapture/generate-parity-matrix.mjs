import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { REFERENCE_REVISION } from './baseline-fixtures.mjs';

const sourcePath = path.resolve('docs/REQUIREMENT_TRACEABILITY.md');
const outputPath = path.resolve('docs/GODOT_PORT_PARITY_MATRIX.md');

const ownerByPrefix = {
  GL: 'Session kernel / transition and consequence adapters',
  CITY: 'World, traffic, economy, builder, and service adapters',
  STR: 'Player, vehicle, combat, Heat, and recovery controllers',
  MIS: 'Mission lifecycle / world adapter / outcome service',
  NAR: 'Mission content / dialogue / progression adapters',
  UX: 'Godot UI view models and Control scenes',
  A11Y: 'Settings/InputMap adapters and accessible UI scenes',
  SAVE: 'Persistence service / file repository / restore adapters',
  PERF: 'Simulation host / render and resource owners',
  REL: 'Boot, diagnostics, CI, compatibility, and release tooling'
};

const evidenceByPrefix = {
  GL: '`game-state.json`, `missions.json`, browser reference manifest, transition tests',
  CITY: '`content-registry.json`, `economy.json`, `world-landmarks.json`, city/economy tests',
  STR: '`seeded-agents-navigation.json`, `world-landmarks.json`, gameplay and browser tests',
  MIS: '`missions.json`, save fixtures, mission tests, mission reference screenshots',
  NAR: '`content-registry.json`, `missions.json`, mission/dialogue reference screenshots',
  UX: 'browser reference screenshots/telemetry and `test/browser/smoke.spec.js`',
  A11Y: '`settings-bindings-alerts.json`, settings/input tests, browser reference screenshots',
  SAVE: '`save-*.json`, `save-inspection-migrations.json`, persistence and browser tests',
  PERF: '`PERFORMANCE_BASELINE_2026-07-17.md`, browser telemetry, scheduler fixture',
  REL: '`environment.json`, CI workflow, fixture manifest, unit/build/browser reports'
};

const explicitPhase = {
  'GL-001': '7–8', 'GL-002': '8', 'GL-003': '8', 'GL-004': '8–9',
  'GL-005': '9', 'GL-006': '5', 'GL-007': '11', 'GL-008': '5/8',
  'GL-009': '7', 'GL-010': '5',
  'CITY-001': '4', 'CITY-002': '2/7', 'CITY-003': '7/9', 'CITY-004': '7',
  'CITY-005': '2/7', 'CITY-006': '2/7', 'CITY-007': '7/9', 'CITY-008': '7',
  'CITY-009': '7', 'CITY-010': '6–7', 'CITY-011': '6–7', 'CITY-012': '7/9',
  'CITY-013': '2/9', 'CITY-014': '4/6/8', 'CITY-015': '6',
  'STR-001': '5/9', 'STR-002': '5', 'STR-003': '2/5/8', 'STR-004': '5',
  'STR-005': '5–6', 'STR-006': '2/5', 'STR-007': '5–6', 'STR-008': '6/8',
  'STR-009': '5–6', 'STR-010': '6/9', 'STR-011': '6', 'STR-012': '6/8',
  'UX-001': '7–9', 'UX-002': '3/9', 'UX-003': '5/9', 'UX-004': '9',
  'UX-005': '7/9', 'UX-006': '8–9', 'UX-007': '9', 'UX-008': '9',
  'UX-009': '2/8/9', 'UX-010': '5/9',
  'A11Y-001': '3/9', 'A11Y-002': '3/5/9', 'A11Y-003': '9', 'A11Y-004': '9',
  'A11Y-005': '9', 'A11Y-006': '9', 'A11Y-007': '3/9', 'A11Y-008': '3/9',
  'A11Y-009': '5/9', 'A11Y-010': '9',
  'SAVE-001': '3', 'SAVE-002': '2–3', 'SAVE-003': '3/8', 'SAVE-004': '3/9',
  'SAVE-005': '3', 'SAVE-006': '3/11', 'SAVE-007': '3/7/8/11', 'SAVE-008': '2/8',
  'SAVE-009': '2–3', 'SAVE-010': '3/9',
  'REL-001': '1/11', 'REL-002': '11', 'REL-003': '3/11', 'REL-004': '1/3/11',
  'REL-005': '2/11', 'REL-006': '1/11', 'REL-007': '11', 'REL-008': '11',
  'REL-009': '2/9/11', 'REL-010': '2–3', 'REL-011': '1/3/11', 'REL-012': '11'
};

const manualTokens = new Set([
  'Playtest', 'UX', 'Visual', 'Manual', 'Release', 'Review', 'Matrix',
  'Content exercise', 'Content review', 'Editorial review', 'A11y'
]);

function phaseFor(id) {
  if (explicitPhase[id]) return explicitPhase[id];
  if (id.startsWith('MIS-')) return '8';
  if (id.startsWith('NAR-')) return id === 'NAR-007' ? '8–9' : '8';
  if (id.startsWith('PERF-')) return '11';
  return 'TBD';
}

function splitTests(required) {
  const tokens = required.split('+').map(value => value.trim());
  const manual = tokens.filter(token => manualTokens.has(token) || /playtest|visual|manual|review|release|matrix|UX|A11y/i.test(token));
  const automated = tokens.filter(token => !manual.includes(token));
  return {
    automated: automated.join(' + ') || 'Supporting automation only',
    manual: manual.join(' + ') || 'None named'
  };
}

const source = await readFile(sourcePath, 'utf8');
let section = null;
const rows = [];
for (const line of source.split('\n')) {
  const heading = /^## (.+)$/.exec(line);
  if (heading && !['Status and test policy'].includes(heading[1])) section = heading[1];
  const cells = line.split('|').slice(1, -1).map(value => value.trim());
  if (cells.length !== 6 || !/^[A-Z]+-\d{3}$/.test(cells[0])) continue;
  const [id, requirement, responsible, requiredTest, verificationOwner, state] = cells;
  const prefix = id.split('-')[0];
  const tests = splitTests(requiredTest);
  rows.push({
    section,
    id,
    requirement,
    responsible,
    requiredTest,
    verificationOwner,
    state,
    prefix,
    tests
  });
}

const output = [];
output.push('# MetroPulse Godot 4.6 Port Parity Matrix');
output.push('');
output.push(`> **Browser reference revision:** \`${REFERENCE_REVISION}\`  `);
output.push('> **Fixture manifest:** `test/fixtures/godot-port/phase0/manifest.json`  ');
output.push('> **Browser evidence:** `docs/port_evidence/phase0/browser/manifest.json`  ');
output.push('> **Policy:** Browser state is evidence about the frozen source only. No row is a Godot pass until its automated and manual acceptance are complete.');
output.push('');
output.push(`This matrix contains all ${rows.length} permanent requirement IDs from \`REQUIREMENT_TRACEABILITY.md\`. `
  + 'The browser evidence column points to the Phase 0 evidence family; individual Godot tests and signoffs replace the planned entries as each phase lands.');
output.push('');

for (const section of [...new Set(rows.map(row => row.section))]) {
  output.push(`## ${section}`);
  output.push('');
  output.push('| ID | Requirement | Browser evidence | Godot owner | Port phase | Automated test | Manual test | Status | Deviation ADR | Signoff |');
  output.push('|---|---|---|---|---:|---|---|---|---|---|');
  for (const row of rows.filter(candidate => candidate.section === section)) {
    output.push(`| ${row.id} | ${row.requirement} | ${evidenceByPrefix[row.prefix]} | ${ownerByPrefix[row.prefix]} | ${phaseFor(row.id)} | ${row.tests.automated} | ${row.tests.manual} | Browser: ${row.state}; Godot: Not Started | — | Pending (${row.verificationOwner}) |`);
  }
  output.push('');
}

output.push('## Update rules');
output.push('');
output.push('1. Replace a planned Godot owner with the concrete C# type/scene when implementation starts.');
output.push('2. Link exact test names and artifact paths; do not mark a row Pass from source-code inspection alone.');
output.push('3. Record approved parity changes in an ADR and link it in the deviation column.');
output.push('4. Only the named verification owner, or an explicitly delegated reviewer, may complete signoff.');
output.push('');

await writeFile(outputPath, `${output.join('\n')}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ output: 'docs/GODOT_PORT_PARITY_MATRIX.md', requirements: rows.length }, null, 2)}\n`);
