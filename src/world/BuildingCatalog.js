export const BUILDING_CATEGORIES = {
  COMMERCIAL: 'Commercial & Skyscraper',
  RESIDENTIAL: 'Residential & Housing',
  CIVIC: 'Civic & Medical Services',
  INFRASTRUCTURE: 'Roads & Energy Grid'
};

export const BUILDING_CATALOG = [
  // Commercial
  {
    id: 'NEOTECH_HQ',
    name: 'NeoTech Quantum Tower',
    category: 'COMMERCIAL',
    icon: '🏢',
    description: 'High-tech AI and robotics research tower with neon cyber accents and rooftop landing pad.',
    footprint: { width: 40, depth: 40 },
    height: 75,
    cost: 750000,
    baseColor: 0x3b4d68,
    accentColor: 0x00f0ff,
    generatorType: 'SKYSCRAPER',
    employees: 1420,
    specialty: 'Quantum AI & Robotics'
  },
  {
    id: 'APEX_BANK',
    name: 'Apex Financial Spire',
    category: 'COMMERCIAL',
    icon: '🏦',
    description: 'Decentralized financial headquarters featuring golden architectural ribs and corporate beacon.',
    footprint: { width: 44, depth: 44 },
    height: 85,
    cost: 650000,
    baseColor: 0x475569,
    accentColor: 0xffaa00,
    generatorType: 'SKYSCRAPER',
    employees: 980,
    specialty: 'Decentralized Crypto Banking'
  },
  {
    id: 'CYBERCAFE',
    name: 'CyberCafe 24/7',
    category: 'COMMERCIAL',
    icon: '☕',
    description: 'Bustling cyber cafe with glowing magenta canopy and high-speed quantum network access.',
    footprint: { width: 30, depth: 30 },
    height: 25,
    cost: 200000,
    baseColor: 0x5a3e73,
    accentColor: 0xff00ff,
    generatorType: 'SHOP',
    signText: '☕ CYBERCAFE',
    employees: 35,
    specialty: 'High-Speed Gaming & Coffee'
  },
  {
    id: 'GALAXY_CINEMA',
    name: 'Galaxy Hologram Cinema',
    category: 'COMMERCIAL',
    icon: '🎬',
    description: 'Futuristic multiplex displaying immersive 3D holographic movie experiences.',
    footprint: { width: 36, depth: 36 },
    height: 35,
    cost: 420000,
    baseColor: 0x4f3f6e,
    accentColor: 0xffb800,
    generatorType: 'SHOP',
    signText: '🎬 GALAXY CINEMA',
    employees: 85,
    specialty: 'Immerse-3D Hologram Movies'
  },

  // Residential
  {
    id: 'SKYLINE_CONDOS',
    name: 'Skyline Luxury Condos',
    category: 'RESIDENTIAL',
    icon: '🏙️',
    description: 'Multi-tiered residential skyscraper with wraparound panoramic glass balconies.',
    footprint: { width: 36, depth: 36 },
    height: 55,
    cost: 500000,
    baseColor: 0x3d4a5c,
    accentColor: 0x44ddaa,
    generatorType: 'RESIDENTIAL',
    residents: 340,
    specialty: 'Skyline Residential Living'
  },
  {
    id: 'METRO_LOFTS',
    name: 'Metro Cyber Lofts',
    category: 'RESIDENTIAL',
    icon: '🏬',
    description: 'Contemporary urban residential lofts designed for metropolitan living.',
    footprint: { width: 30, depth: 30 },
    height: 38,
    cost: 350000,
    baseColor: 0x4e4e58,
    accentColor: 0x66ccff,
    generatorType: 'RESIDENTIAL',
    residents: 180,
    specialty: 'Urban Cyber Lofts'
  },
  {
    id: 'GARDEN_TOWER',
    name: 'Eco-Spire Garden Tower',
    category: 'RESIDENTIAL',
    icon: '🌿',
    description: 'Sustainable vertical garden complex with illuminated terrace gardens and clean energy systems.',
    footprint: { width: 38, depth: 38 },
    height: 68,
    cost: 480000,
    baseColor: 0x2e5a44,
    accentColor: 0x44ff88,
    generatorType: 'RESIDENTIAL',
    residents: 520,
    specialty: 'Vertical Eco-Living'
  },

  // Civic & Medical
  {
    id: 'MED_CENTER',
    name: 'Bio-Regen Medical Center',
    category: 'CIVIC',
    icon: '🏥',
    description: 'State-of-the-art cybernetic emergency medical hospital and trauma recovery center.',
    footprint: { width: 42, depth: 42 },
    height: 45,
    cost: 400000,
    baseColor: 0xeeeeee,
    accentColor: 0xff3344,
    generatorType: 'CIVIC',
    signText: '🏥 BIO-REGEN MEDICAL',
    employees: 310,
    specialty: 'Emergency Cyber Trauma Care'
  },
  {
    id: 'CYBER_POLICE',
    name: 'Metro Peacekeeping Precinct',
    category: 'CIVIC',
    icon: '🚓',
    description: 'Metropolitan police precinct equipped with drone launch bays and security command array.',
    footprint: { width: 34, depth: 34 },
    height: 30,
    cost: 320000,
    baseColor: 0x2c3e50,
    accentColor: 0x3498db,
    generatorType: 'CIVIC',
    signText: '🚓 METRO PRECINCT',
    employees: 140,
    specialty: 'City Peacekeeping & Drones'
  },
  {
    id: 'SOLAR_PLAZA',
    name: 'Cyber Plaza & Fountain',
    category: 'CIVIC',
    icon: '⛲',
    description: 'Public park and gathering plaza featuring glowing bio-trees and a illuminated water fountain.',
    footprint: { width: 40, depth: 40 },
    height: 8,
    cost: 150000,
    baseColor: 0x224433,
    accentColor: 0x00ffcc,
    generatorType: 'PARK_PLAZA',
    specialty: 'Public Leisure & Recreation'
  },

  // Infrastructure & Utilities
  {
    id: 'ROAD_STRAIGHT',
    name: 'Asphalt Road Segment',
    category: 'INFRASTRUCTURE',
    icon: '🛣️',
    description: 'Standard 30m asphalt roadway with glowing lane dividers and sidewalk curbs.',
    footprint: { width: 30, depth: 30 },
    height: 1,
    cost: 25000,
    baseColor: 0x24272c,
    accentColor: 0xffffaa,
    generatorType: 'ROAD_SEGMENT',
    roadType: 'STRAIGHT',
    specialty: 'Vehicle Road Network'
  },
  {
    id: 'ROAD_INTERSECTION',
    name: '4-Way Road Crossing',
    category: 'INFRASTRUCTURE',
    icon: '➕',
    description: 'Four-way intersection junction connecting urban road blocks with crosswalks.',
    footprint: { width: 30, depth: 30 },
    height: 1,
    cost: 35000,
    baseColor: 0x24272c,
    accentColor: 0x00ffff,
    generatorType: 'ROAD_SEGMENT',
    roadType: 'INTERSECTION',
    specialty: 'Traffic Junction'
  },
  {
    id: 'SOLAR_GRID',
    name: 'Quantum Energy Array',
    category: 'UTILITIES',
    icon: '⚡',
    description: 'High-output solar and zero-point energy generation station powering the city.',
    footprint: { width: 26, depth: 26 },
    height: 15,
    cost: 280000,
    baseColor: 0x1a2b3c,
    accentColor: 0x00ffaa,
    generatorType: 'ENERGY_ARRAY',
    specialty: 'Clean Power Grid'
  }
];

export function getCatalogByCategory(category) {
  if (!category || category === 'ALL') return BUILDING_CATALOG;
  return BUILDING_CATALOG.filter(item => item.category === category || (category === 'UTILITIES' && item.category === 'INFRASTRUCTURE'));
}

export function getBuildingSpec(id) {
  return BUILDING_CATALOG.find(item => item.id === id) || BUILDING_CATALOG[0];
}
