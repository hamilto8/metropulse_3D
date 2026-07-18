/** Phase 0 product-scope constants. Changes require a written GDD amendment. */
export const MVP_WORLD_FOOTPRINT = Object.freeze([
  'WEST_CORE',
  'CENTRAL_PARK',
  'PRIMARY_BRIDGE_CORRIDOR'
]);

export const MVP_ACTIVITY_TEMPLATES = Object.freeze([
  'TAXI',
  'COURIER',
  'DELIVERY',
  'RACE',
  'SABOTAGE',
  'SURVIVAL'
]);

export const MVP_MISSION_IDS = Object.freeze([
  'mission_executive',
  'mission_scientist',
  'mission_police_robbery',
  'mission_police_park',
  'mission_sports_trial',
  'mission_sports_smuggle',
  'mission_bus_loop',
  'mission_truck_delivery',
  'mission_sedan_grocery',
  'mission_mayhem_escape'
]);

export const MVP_ZONE_LABELS = Object.freeze({
  RESIDENTIAL: 'Residential',
  COMMERCIAL: 'Commercial',
  INDUSTRIAL: 'Operations'
});

if (MVP_MISSION_IDS.length < 8 || MVP_MISSION_IDS.length > 12) {
  throw new Error('MVP mission scope must remain between 8 and 12 authored missions');
}
if (MVP_ACTIVITY_TEMPLATES.length < 5 || MVP_ACTIVITY_TEMPLATES.length > 7) {
  throw new Error('MVP activity scope must remain between 5 and 7 templates');
}

