# 🏙️ MetroPulse 3D | Cyber-Modern Metropolis Simulation

[![Built with Three.js](https://img.shields.io/badge/Three.js-r172-black?style=for-the-badge&logo=three.js)](https://threejs.org/)
[![Built with Vite](https://img.shields.io/badge/Vite-8.1-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-00f0ff?style=for-the-badge)](https://opensource.org/licenses/MIT)

![MetroPulse 3D Cyber-Modern Metropolis Simulation](public/hero.png)

**MetroPulse 3D** is an interactive, visually stunning 3D modern city simulation running entirely in your web browser. Experience a living urban metropolis complete with a dynamic day-night cycle, autonomous traffic crossing a grand suspension bridge, expressive pedestrian crowds, neon-lit cyberpunk storefronts, animated 3D billboards, an apocalyptic **Fun Mode (MAYHEM!)**, and a state-of-the-art procedural Web Audio soundscape.

---

## ✨ Features

### 🌉 City Expansion: River, Grand Suspension Bridge & East District
- **Shimmering River Channel**: A 50-unit wide deep river basin bordered by concrete retaining walls flowing north-south across the entire length of the metropolis (`Z = -350` to `+350`).
- **Grand Suspension Bridge**: An iconic golden-gate styled suspension bridge spanning across the river at `Z = 0`. Built with towering 65-unit crimson steel pillars, glowing red beacon towers at night, swooping suspension cables, vertical suspender rods, a bi-directional vehicle road deck, and pedestrian sidewalks!
- **East District Cyber-Metropolis**: A massive urban expansion on the east bank (`X = 200` to `X = 350`) populated with 15+ new cyberpunk corporation skyscrapers (*Orbital Systems*, *Quantum Dynamics*, *Valkyrie Motors*, *Aether Skyspire*), neon storefronts, streetlamps, and plazas!
- **Seamless Cross-River Traffic & AI**: Autonomous vehicles and pedestrians seamlessly cross the river between the West and East districts along the bridge decks and sidewalks!
- **Bridge Camera Preset**: Jump straight to a breathtaking cinematic camera view (`🌉 Bridge`) of the suspension bridge and waterfront skyline!

### 🔥 Fun Mode: Apocalyptic Mayhem & Capitalist Satire
- **Flaming Comet Shower**: Toggle Fun Mode to transform the sky into an ominous orange-red apocalyptic horizon and unleash a chaotic rain of meteors!
- **Building Destruction to Rubble**: When a comet scores a direct hit on a skyscraper, the earth shakes with earthquake camera effects and the building is dramatically shattered into smoking concrete rubble!
- **Ominous Soundscape**: Blaring tornado sirens echo across the city alongside panicked crowd sound effects!
- **Satirical News Chyron**: A cyberpunk emergency news ticker overlay slides onto the bottom of the screen (`🚨 METROPULSE NEWS ALERT 🚨`), displaying continuous scrolling capitalist satire headlines mocking real estate values, inflation, and corporate synergy during extinction events!

### 🌅 Dynamic Day - Night & Atmospheric Engine
- **Time Slider & Clock**: Responsive 24-hour time slider (`00:00` to `24:00`) with real-time digital clock, time phase indicators (*Dawn*, *Daytime*, *Dusk*, *Nighttime*), play/pause time progression, and speed multipliers (`0.5x`, `1x`, `5x`, `15x`).
- **Orbital Sun & Moon**: Real-time orbital calculation for sun and moon positions casting dynamic soft shadows (`PCFSoftShadowMap`).
- **Sky Atmosphere Transitions**: Smooth background and fog color interpolation from warm pink/amber dawn to bright azure daytime, deep purple dusk, and starry midnight navy.
- **Automatic Night Illumination**: As dusk sets in (`18:00`), skyscraper window grids illuminate, bridge beacon towers pulse, streetlamps project warm cones of light onto the asphalt, neon storefronts intensify their bloom glow, and car headlights/taillights switch on!

### 🚗 Autonomous Traffic & Vehicle AI
- **48 AI Vehicles**: Navigating an expanded multi-lane city and bridge road graph with waypoint steering, turning at intersections, and collision avoidance braking.
- **6 Distinct Vehicle Types**:
  - Sleek **Sedans** & aerodynamic **Sports Cars**
  - City Transit **Buses** & Delivery **Trucks**
  - City Yellow **Taxis**
  - **Police Cruisers** with dynamic flashing red & blue siren light bars!
- **Realistic Physics & Animation**: Rotating wheel cylinders matched to driving speed and realistic deceleration.

### 🚶 Expressive Pedestrian Crowd Simulation
- **60 Low-Poly Humanoids**: Stylized characters with articulated heads, torsos, arms, and legs actively exploring both city districts and crossing the suspension bridge.
- **Pedestrian Classes**: Business professionals carrying briefcases, casual citizens in colorful hoodies, and joggers moving at higher speeds around Central Park.
- **Smart Walking AI**: Natural limb-swinging animation while walking along sidewalk loops and crosswalks.

### 🏢 Architecture & Custom Business Storefronts
- **Sleek Skyscrapers**: Glass towers with architectural bevels and procedural window grid room lights.
- **Distinct Commercial Storefronts**:
  - **NeoTech HQ**: Futuristic corporate tower with glowing blue ribs.
  - **CyberCafe 24/7**: Coffee shop with outdoor seating and neon mug signage.
  - **Apex Bank**: Classic modern stone facade with gold pillars.
  - **Starlight Hotel**: Luxury tower with entrance canopy and glowing magenta sign.
  - **Boba Haven**: Vibrant pastel tea lounge.
  - **Galaxy Cinema**: Entertainment complex featuring an animated marquee billboard.
- **Central Park**: An urban oasis featuring turf grass, diagonal walking paths, shade trees, benches, and a glowing neon water fountain.
- **Live 2D Canvas Billboards**: Live advertisements and a real-time digital clock/news ticker rendered directly onto 3D billboards!

### 🔊 Procedural Web Audio API Synthesizer
- Generates rich real-time city soundscapes with **zero external audio file dependencies**!
- **Daytime Soundscape**: Soft city rumble (low-pass filtered brown noise) and intermittent sine wave arpeggio bird chirps.
- **Nighttime Soundscape**: Deep ambient drone and nocturnal crickets (pulsed high-frequency triangle modulation).
- **Interactive SFX**: Sawtooth car honking, Doppler-effect police siren wail, tornado sirens, crowd panic, and UI sound feedback.

### 👁️ Interactive Object Inspector & Follow Camera
- **Click-to-Inspect**: Click directly onto any moving car, pedestrian, or building to open a sleek HUD data card displaying live statistics (speed, battery level, employee count, business status).
- **Follow Camera Mode**: Attach the camera to any moving vehicle or pedestrian to ride along with them across the suspension bridge and through the city streets!
- **Camera Preset Sidebar**: Instant camera jump buttons for *"Bird's Eye View"*, *"Street Level"*, *"Central Park"*, *"Downtown Intersection"*, *"Bridge"*, and *"Free Orbit"*.
- **Weather Controls**: Toggle between **Clear Sky**, **Cyber Mist**, and **Rainy Night** with particle physics!

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18+ recommended)
- `npm` or `yarn`

### Installation & Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/hamilto8/metropulse_3D.git
   cd metropulse_3D
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local development server:**
   ```bash
   npm run dev
   ```

4. **Open in your browser:**
   Navigate to `http://localhost:5173/` in any modern WebGL-enabled browser.

### Building for Production

To create an optimized production build:
```bash
npm run build
```
The compiled bundles will be output to the `/dist` directory, ready for deployment to GitHub Pages, Vercel, Netlify, or any static hosting service.

---

## 🛠️ Technology Stack
- **Core**: HTML5, Vanilla JavaScript (ES Modules)
- **3D Graphics Engine**: [Three.js](https://threejs.org/) (WebGLRenderer, OrbitControls, Shadow Mapping, InstancedMesh)
- **Styling & UI**: Vanilla CSS with modern Glassmorphism aesthetics (`backdrop-filter`, CSS variables, flexbox/grid)
- **Audio**: Native Web Audio API (`AudioContext`, procedural oscillators, filters, noise generators)
- **Build Tool**: [Vite](https://vitejs.dev/)

---

## 🎮 Controls & Usage Guide

| Action | Control |
| :--- | :--- |
| **Orbit Camera** | Left Mouse Drag |
| **Pan Camera** | Right Mouse Drag / Shift + Left Drag |
| **Zoom In / Out** | Mouse Wheel Scroll |
| **Adjust Time of Day** | Drag bottom Time Slider (`00:00` to `24:00`) |
| **Play / Pause Time** | Click `⏸️` / `▶️` button on bottom bar |
| **Time Speed** | Click `0.5x`, `1x`, `5x`, or `15x` speed multiplier buttons |
| **Toggle Fun Mode** | Click `🔥 Fun Mode: OFF / MAYHEM! 🔥` on left sidebar to unleash comets, rubble, sirens & satirical chyron |
| **Inspect Object** | Left Click on any vehicle, pedestrian, or building |
| **Follow Target** | Click `👁️ Follow Camera` in the Inspector HUD card |
| **Trigger SFX** | Click `📯 Sound Honk` or `🚨 Sound Siren` in Inspector HUD |
| **Enable Audio** | Click `🔇 Enable SFX` on left sidebar |
| **Change Weather** | Click `☀️ Clear`, `🌫️ Mist`, or `🌧️ Rain` on left sidebar |
| **Camera Presets** | Click `🚁 Bird's Eye`, `🏙️ Street Level`, `🌳 Central Park`, `🚦 Downtown`, `🌉 Bridge`, or `🌐 Free Orbit` |

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
