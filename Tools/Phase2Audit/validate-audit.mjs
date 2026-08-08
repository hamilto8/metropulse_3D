import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const auditPath = path.join(repositoryRoot, 'docs/port_evidence/phase2/test-family-audit.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const failures = [];

function filesBelow(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'bin' || entry.name === 'obj' ? [] : filesBelow(entryPath, extension);
    }
    return entryPath.endsWith(extension) ? [entryPath] : [];
  });
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

requireCondition(audit.schemaVersion === 1, 'schemaVersion must be 1');
requireCondition(audit.referenceRevision === '44a286a74557adfe4fabd3a6e16b9006079eba32',
  'referenceRevision must remain the frozen Phase 0 revision');
requireCondition(audit.comparisonPolicy?.doubleAbsoluteEpsilon === 1e-9,
  'doubleAbsoluteEpsilon must remain 1e-9');
requireCondition(audit.comparisonPolicy?.positionAbsoluteMeters === 0.01,
  'positionAbsoluteMeters must remain 0.01');
requireCondition(audit.comparisonPolicy?.physics === 'scenario-envelope',
  'physics comparison must use scenario envelopes');

const actualPaths = fs.readdirSync(path.join(repositoryRoot, 'test'))
  .filter(name => name.endsWith('.test.js'))
  .map(name => `test/${name}`)
  .sort();
const entries = Array.isArray(audit.testFiles) ? audit.testFiles : [];
const auditedPaths = entries.map(entry => entry.path).sort();
requireCondition(new Set(auditedPaths).size === auditedPaths.length, 'testFiles contains duplicate paths');
requireCondition(JSON.stringify(auditedPaths) === JSON.stringify(actualPaths),
  'testFiles must classify every top-level browser unit-test file exactly once');

const classifications = new Set(['phase2-owned', 'mixed', 'deferred', 'evidence-only']);
for (const entry of entries) {
  requireCondition(classifications.has(entry.classification),
    `${entry.path}: unknown classification ${entry.classification}`);
  if (entry.classification === 'phase2-owned' || entry.classification === 'mixed') {
    requireCondition(typeof entry.phase2Owner === 'string' && entry.phase2Owner.length > 0,
      `${entry.path}: phase2Owner is required`);
    requireCondition(Array.isArray(entry.phase2Tests) && entry.phase2Tests.length > 0,
      `${entry.path}: phase2Tests are required`);
  }
  if (entry.classification === 'mixed' || entry.classification === 'deferred') {
    requireCondition(Array.isArray(entry.deferredPhase)
      && entry.deferredPhase.length > 0
      && entry.deferredPhase.every(phase => Number.isInteger(phase) && phase > 2),
    `${entry.path}: later deferredPhase values are required`);
    requireCondition(typeof entry.deferredOwner === 'string' && entry.deferredOwner.length > 0,
      `${entry.path}: deferredOwner is required`);
  }
  if (entry.classification === 'evidence-only') {
    requireCondition(typeof entry.reason === 'string' && entry.reason.length > 0,
      `${entry.path}: evidence-only reason is required`);
  }
}

const counts = Object.fromEntries([...classifications].map(classification => [
  classification,
  entries.filter(entry => entry.classification === classification).length
]));

const domainRoot = path.join(repositoryRoot, 'godot/MetroPulse.Domain');
const domainFiles = filesBelow(domainRoot, '.cs');
const forbiddenDomainPatterns = [
  [/\busing\s+Godot(?:\.|;)/, 'Godot namespace import'],
  [/\bGodot\./, 'Godot type reference'],
  [/\bRandom\.Shared\b/, 'Random.Shared'],
  [/\bnew\s+(?:System\.)?Random\s*\(/, 'unnamed Random construction'],
  [/\bSystem\.Random\b/, 'System.Random reference']
];
for (const file of domainFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [pattern, label] of forbiddenDomainPatterns) {
    requireCondition(!pattern.test(source),
      `${path.relative(repositoryRoot, file)}: forbidden ${label}`);
  }
}
const domainProject = fs.readFileSync(path.join(domainRoot, 'MetroPulse.Domain.csproj'), 'utf8');
requireCondition(!domainProject.includes('<ProjectReference'),
  'MetroPulse.Domain.csproj must not reference an engine project');

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, files: entries.length, counts, domainFiles: domainFiles.length }, null, 2));
}
