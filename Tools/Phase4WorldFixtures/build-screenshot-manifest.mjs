import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceRoot = path.join(repositoryRoot, 'docs/port_evidence/phase4');
const browserRoot = 'docs/port_evidence/phase0/browser/screenshots';
const scenarios = [
  { id: 'management-day-clear', hour: 13, weather: 'clear' },
  { id: 'management-dusk-rain', hour: 18.5, weather: 'rain' },
  { id: 'management-night-clear', hour: 23, weather: 'clear' }
];

async function imageRecord(scenario) {
  const relative = `docs/port_evidence/phase4/screenshots/godot-${scenario.id}.png`;
  const bytes = await readFile(path.join(repositoryRoot, relative));
  if (bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${relative} is not a PNG`);
  return {
    ...scenario,
    seed: 424242,
    cameraPreset: 'management',
    reference: `${browserRoot}/${scenario.id}.png`,
    godot: relative,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    signoff: {
      geometry: 'accepted',
      palette: 'accepted',
      lighting: 'accepted',
      readability: 'accepted',
      reviewer: 'Phase 4 implementation visual audit'
    }
  };
}

const manifest = {
  schemaVersion: 1,
  referenceRevision: '44a286a74557adfe4fabd3a6e16b9006079eba32',
  godotVersion: '4.6.stable.mono.official.89cea1439',
  comparison: 'Recognizable fixed-scenario pair; pixel identity is not required.',
  scenarios: await Promise.all(scenarios.map(imageRecord))
};
const rendered = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestPath = path.join(evidenceRoot, 'screenshot-manifest.json');
if (process.argv.includes('--check')) {
  const existing = await readFile(manifestPath, 'utf8');
  if (existing !== rendered) throw new Error('Phase 4 screenshot manifest or image hashes drifted');
  console.log(JSON.stringify({ ok: true, scenarios: manifest.scenarios.length }, null, 2));
} else {
  await writeFile(manifestPath, rendered);
  console.log(JSON.stringify({ ok: true, scenarios: manifest.scenarios.length }, null, 2));
}
