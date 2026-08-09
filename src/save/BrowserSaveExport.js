import { getProductionContentRegistry } from '../data/GameDataValidator.js';
import { validateGameState } from './SaveGameState.js';
import { SAVE_SLOTS, validateSaveDocument } from './SaveSchema.js';

function safeFilename(value) {
  return String(value || 'city').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'city';
}

export function downloadSaveJson({ filename, text }, {
  documentRef = globalThis.document,
  urlRef = globalThis.URL,
  BlobType = globalThis.Blob
} = {}) {
  if (!documentRef?.createElement || !urlRef?.createObjectURL || !BlobType) {
    throw new Error('Browser save download is unavailable.');
  }
  const blob = new BlobType([text], { type: 'application/json' });
  const url = urlRef.createObjectURL(blob);
  try {
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
  } finally {
    urlRef.revokeObjectURL(url);
  }
}

/** Reads one selected slot, validates it without live-owner mutation, and downloads plain JSON. */
export async function exportCitySave({
  repository,
  slot = SAVE_SLOTS.CURRENT,
  contentRegistry = getProductionContentRegistry(),
  download = downloadSaveJson
} = {}) {
  if (!repository?.read) throw new TypeError('City save export requires a repository with read(slot).');
  if (![SAVE_SLOTS.CURRENT, SAVE_SLOTS.RECOVERY].includes(slot)) throw new RangeError(`Unknown save slot: ${slot}`);
  const selected = await repository.read(slot);
  if (selected == null) throw new Error(`No ${slot} city save is available to export.`);
  const document = validateSaveDocument(selected, {
    validateDomains: data => validateGameState(data, { contentRegistry })
  });
  const filename = `metropulse-city-${safeFilename(document.metadata.saveId)}.json`;
  const text = `${JSON.stringify(document, null, 2)}\n`;
  await download({ filename, text, document, slot });
  return Object.freeze({
    slot,
    filename,
    saveId: document.metadata.saveId,
    savedAt: document.metadata.savedAt,
    bytes: new TextEncoder().encode(text).byteLength
  });
}

export default exportCitySave;
