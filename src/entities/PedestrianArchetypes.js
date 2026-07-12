const SKIN_TONES = Object.freeze([0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3317]);
const HAIR_COLORS = Object.freeze([0x17120f, 0x3b2416, 0x6b4423, 0xb56b2d, 0xd6c3a5, 0x442713]);

export const PEDESTRIAN_ARCHETYPES = Object.freeze({
  BUSINESS: Object.freeze({
    label: 'Professional', maxSpeed: 3.5, activity: 'Commuting to Office', mood: 'Focused',
    colors: [0x1d4ed8, 0x334155, 0x4c1d95, 0x0f766e], hair: ['SHORT', 'PARTED'], accessory: 'BRIEFCASE'
  }),
  CASUAL: Object.freeze({
    label: 'Resident', maxSpeed: 2.8, activity: 'Strolling Downtown', mood: 'Relaxed',
    colors: [0xdb2777, 0xd97706, 0x0891b2, 0x16a34a, 0x7c3aed], hair: ['SHORT', 'CURLY', 'PONYTAIL', 'BALD'], accessory: null
  }),
  JOGGER: Object.freeze({
    label: 'Jogger', maxSpeed: 5.5, activity: 'Running the City Loop', mood: 'Energized',
    colors: [0x16a34a, 0xef4444, 0x0ea5e9, 0xf97316], hair: ['SHORT', 'PONYTAIL'], accessory: 'HEADBAND'
  }),
  CAFE_READER: Object.freeze({
    label: 'Café Patron', maxSpeed: 2.6, activity: 'Reading at Sidewalk Café', mood: 'Absorbed',
    colors: [0x7c3aed, 0xbe185d, 0x0369a1, 0x4d7c0f], hair: ['SHORT', 'CURLY', 'PONYTAIL'], accessory: 'BOOK'
  }),
  TOURIST: Object.freeze({
    label: 'Tourist', maxSpeed: 2.5, activity: 'Exploring Landmarks', mood: 'Curious',
    colors: [0xeab308, 0x0284c7, 0xdc2626, 0x059669], hair: ['CAP', 'SHORT', 'CURLY'], accessory: 'PHONE'
  }),
  CRIMINAL: Object.freeze({
    label: 'Troublemaker', maxSpeed: 4.2, activity: 'Loitering Suspiciously', mood: 'Hostile',
    colors: [0x27272a, 0x3f3f46, 0x7f1d1d, 0x1e293b], hair: ['BEANIE', 'BUZZ'], accessory: null
  })
});

// Twenty entries make the population mix explicit and deterministic: 30%
// casual, 20% professional, 15% jogger, 10% café reader, 15% tourist, 10% criminal.
export const PEDESTRIAN_ARCHETYPE_SEQUENCE = Object.freeze([
  'CASUAL', 'BUSINESS', 'JOGGER', 'CASUAL', 'TOURIST',
  'BUSINESS', 'CAFE_READER', 'CASUAL', 'CRIMINAL', 'JOGGER',
  'TOURIST', 'CASUAL', 'BUSINESS', 'CAFE_READER', 'CASUAL',
  'JOGGER', 'TOURIST', 'BUSINESS', 'CRIMINAL', 'CASUAL'
]);

function safeRandom(random) {
  try {
    const value = Number(random?.());
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
  } catch {
    return 0.5;
  }
}

function choose(values, random) {
  return values[Math.floor(safeRandom(random) * values.length)];
}

export function createPedestrianDescriptor(serial, random = Math.random) {
  const safeSerial = Number.isInteger(serial) && serial >= 0 ? serial : 0;
  const archetype = PEDESTRIAN_ARCHETYPE_SEQUENCE[safeSerial % PEDESTRIAN_ARCHETYPE_SEQUENCE.length];
  const profile = PEDESTRIAN_ARCHETYPES[archetype];
  return {
    archetype,
    profile,
    color: choose(profile.colors, random),
    appearance: {
      skinTone: choose(SKIN_TONES, random),
      hairColor: choose(HAIR_COLORS, random),
      hairStyle: choose(profile.hair, random),
      pantsColor: choose([0x111827, 0x292524, 0x1e3a5f, 0x3f3f46], random),
      heightScale: 0.86 + safeRandom(random) * 0.1,
      accessory: profile.accessory
    }
  };
}
