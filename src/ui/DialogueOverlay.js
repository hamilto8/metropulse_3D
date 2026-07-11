/**
 * DialogueOverlay.js
 * MVC/MVVM-based dialogue parser and UI modal controller for MetroPulse 3D missions.
 * Renders branching JSON dialogue trees, avatars, animated text, and interactive choices.
 */
function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export class DialogueOverlay {
  constructor() {
    this.overlay = document.getElementById('dialogue-overlay');
    this.avatarEl = document.getElementById('dialogue-avatar');
    this.speakerEl = document.getElementById('dialogue-speaker');
    this.roleEl = document.getElementById('dialogue-role');
    this.textEl = document.getElementById('dialogue-text');
    this.choicesEl = document.getElementById('dialogue-choices');
    this.closeBtn = document.getElementById('btn-close-dialogue');

    /** @type {object|null} Currently displayed mission, or null if overlay is hidden */
    this.currentMission = null;
    /** @type {import('../systems/MissionSystem.js').MissionSystem|null} */
    this.missionSystem = null;
    this.currentNodeId = 'start';

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.hide());
    }
  }

  /**
   * Opens the dialogue overlay and begins rendering the 'start' node of a mission.
   * @param {object} mission - Mission data object from missions.json
   * @param {object} missionSystem - MissionSystem instance (for callbacks on accept/decline)
   */
  showMissionDialogue(mission, missionSystem) {
    if (!this.overlay || !mission) return;
    this.currentMission = mission;
    this.missionSystem = missionSystem;
    this.currentNodeId = 'start';

    this.renderNode(this.currentNodeId);
    this.overlay.classList.remove('hidden');
  }

  /**
   * Renders a single dialogue node by ID, populating speaker info and choice buttons.
   * Automatically calls hide() if the node ID is not found in the tree.
   * @param {string} nodeId - Key in the mission's dialogueTree object
   */
  renderNode(nodeId) {
    if (!this.currentMission || !this.currentMission.dialogueTree) return;
    const node = this.currentMission.dialogueTree[nodeId];
    if (!node) {
      this.hide();
      return;
    }

    this.renderSketchPortrait(this.currentMission);
    if (this.speakerEl) this.speakerEl.textContent = this.currentMission.passengerName || 'Passenger';
    if (this.roleEl) this.roleEl.textContent = this.currentMission.passengerRole || 'Citizen';
    if (this.textEl) this.textEl.textContent = node.text || '';

    // Clear previous choices
    if (this.choicesEl) {
      this.choicesEl.innerHTML = '';
    }

    // Terminal node: START_MISSION — show a single "Let's Go" confirmation button
    if (node.action === 'START_MISSION') {
      const startBtn = document.createElement('button');
      startBtn.className = 'dialogue-choice-btn';
      startBtn.textContent = '🚕 Start Ride / Let\'s Go!';
      startBtn.addEventListener('click', () => {
        // Capture both refs BEFORE calling hide(), which nulls them out.
        const mission = this.currentMission;
        const missionSystem = this.missionSystem;
        this.hide();
        // Now safe to call startMission with the captured refs.
        if (missionSystem && mission) {
          missionSystem.startMission(mission, node);
        }
      });
      this.choicesEl.appendChild(startBtn);
      return;
    }

    // Terminal node: DECLINE — show a close button only
    if (node.action === 'DECLINE') {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'dialogue-choice-btn';
      closeBtn.textContent = '👋 Close';
      closeBtn.addEventListener('click', () => this.hide());
      this.choicesEl.appendChild(closeBtn);
      return;
    }

    // Branching node: render all choices as buttons
    if (node.choices && Array.isArray(node.choices)) {
      node.choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'dialogue-choice-btn';
        btn.textContent = choice.label;
        btn.addEventListener('click', () => {
          if (this.missionSystem?.recordDialogueChoice) {
            this.missionSystem.recordDialogueChoice(this.currentMission, nodeId, choice);
          }
          this.renderNode(choice.next);
        });
        this.choicesEl.appendChild(btn);
      });
    }
  }

  renderSketchPortrait(mission) {
    const canvas = this.avatarEl;
    const context = canvas?.getContext?.('2d');
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;
    const random = seededRandom(hashText(`${mission.passengerName}|${mission.passengerRole}`));
    const jitter = (amount = 1) => (random() - 0.5) * amount;
    const role = String(mission.passengerRole || '').toLowerCase();
    const accent = ['#00a9b8', '#bc2f76', '#cb7a14'][hashText(mission.passengerName) % 3];

    const sketchLine = (points, passes = 2, widthPx = 1.5) => {
      context.lineWidth = widthPx;
      for (let pass = 0; pass < passes; pass++) {
        context.beginPath();
        points.forEach(([x, y], index) => {
          const px = x + jitter(1.4);
          const py = y + jitter(1.4);
          if (index === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        });
        context.stroke();
      }
    };

    context.clearRect(0, 0, width, height);
    context.fillStyle = '#e8e2d7';
    context.fillRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    // Uneven editorial hatching gives every portrait a hand-inked paper grain.
    context.strokeStyle = 'rgba(20, 26, 34, 0.13)';
    context.lineWidth = 0.8;
    for (let x = -height; x < width; x += 8 + random() * 4) {
      context.beginPath();
      context.moveTo(x + jitter(3), height);
      context.lineTo(x + height + jitter(3), 0);
      context.stroke();
    }

    // Shoulders, collar, and role-neutral silhouette wash.
    context.fillStyle = '#3d4650';
    context.beginPath();
    context.moveTo(13, 112);
    context.quadraticCurveTo(18, 86, 42, 82);
    context.lineTo(70, 82);
    context.quadraticCurveTo(96, 87, 101, 112);
    context.closePath();
    context.fill();
    context.strokeStyle = '#111820';
    sketchLine([[13, 111], [20, 91], [42, 82], [56, 96], [70, 82], [94, 92], [101, 111]], 3, 1.7);

    context.fillStyle = '#c7b7a4';
    context.fillRect(48, 73, 16, 18);
    context.strokeStyle = '#111820';
    sketchLine([[48, 73], [48, 88], [56, 96], [64, 88], [64, 73]], 2, 1.4);

    // Face wash and deliberately imperfect repeated ink outline.
    context.fillStyle = '#d6c5b1';
    context.beginPath();
    context.ellipse(56, 48, 25, 31, jitter(0.08), 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#10161d';
    for (let pass = 0; pass < 3; pass++) {
      context.beginPath();
      context.ellipse(56 + jitter(1.6), 48 + jitter(1.3), 25 + jitter(1), 31 + jitter(1), jitter(0.05), 0, Math.PI * 2);
      context.stroke();
    }

    // Hair shape varies deterministically by passenger.
    context.fillStyle = '#151a20';
    context.beginPath();
    context.moveTo(31, 43);
    for (let x = 32; x <= 80; x += 6) {
      context.lineTo(x, 21 + random() * 12);
    }
    context.lineTo(81, 46);
    context.quadraticCurveTo(74, 26, 56, 20);
    context.quadraticCurveTo(37, 25, 31, 43);
    context.fill();
    context.strokeStyle = '#090d12';
    sketchLine([[31, 43], [35, 27], [48, 20], [65, 22], [78, 31], [81, 46]], 3, 1.5);

    // Brows, eyes, nose, mouth, and cheek hatching.
    context.strokeStyle = '#10161d';
    sketchLine([[39, 43], [48, 41]], 2, 1.7);
    sketchLine([[64, 41], [73, 44]], 2, 1.7);
    context.fillStyle = '#10161d';
    context.beginPath();
    context.arc(45, 48, 1.8, 0, Math.PI * 2);
    context.arc(68, 48, 1.8, 0, Math.PI * 2);
    context.fill();
    sketchLine([[57, 49], [54, 61], [59, 62]], 2, 1.2);
    sketchLine([[46, 69], [55, 71], [65, 68]], 2, 1.4);
    for (let y = 55; y < 70; y += 4) {
      sketchLine([[34, y], [41, y - 3]], 1, 0.7);
      sketchLine([[71, y - 3], [78, y]], 1, 0.7);
    }

    // Small role-specific ink props make the cast readable at a glance.
    context.strokeStyle = accent;
    context.lineWidth = 3;
    if (role.includes('dj')) {
      context.beginPath();
      context.arc(56, 48, 32, Math.PI * 1.08, Math.PI * 1.92);
      context.stroke();
      context.strokeRect(24, 43, 7, 18);
      context.strokeRect(81, 43, 7, 18);
    } else if (role.includes('scient') || role.includes('engineer')) {
      context.beginPath();
      context.arc(45, 49, 8, 0, Math.PI * 2);
      context.arc(68, 49, 8, 0, Math.PI * 2);
      context.moveTo(53, 49);
      context.lineTo(60, 49);
      context.stroke();
    } else if (role.includes('police') || role.includes('officer') || role.includes('dispatcher')) {
      sketchLine([[30, 31], [39, 19], [72, 19], [82, 32]], 2, 2.5);
      context.fillStyle = accent;
      context.fillRect(52, 20, 8, 7);
    } else if (role.includes('racer') || role.includes('sponsor')) {
      sketchLine([[33, 42], [43, 35], [69, 35], [79, 42]], 2, 2.5);
    } else {
      context.fillStyle = accent;
      context.beginPath();
      context.moveTo(51, 92);
      context.lineTo(56, 105);
      context.lineTo(62, 92);
      context.closePath();
      context.fill();
    }

    context.strokeStyle = 'rgba(10, 15, 20, 0.72)';
    context.lineWidth = 2;
    context.strokeRect(3 + jitter(1), 3 + jitter(1), width - 6, height - 6);
    canvas.setAttribute('aria-label', `Hand-drawn ink portrait of ${mission.passengerName}`);
  }

  /**
   * Hides the dialogue overlay and resets all state.
   * Notifies MissionSystem to start the re-trigger cooldown timer.
   * IMPORTANT: After this returns, this.currentMission and this.missionSystem are null.
   * Callers that need those refs must capture them BEFORE calling hide().
   */
  hide() {
    if (this.overlay) {
      this.overlay.classList.add('hidden');
    }
    if (this.missionSystem) {
      this.missionSystem.triggerCooldown = 4.0;
      // Revert state from DIALOGUE_ACTIVE to IDLE if no mission was started
      if (this.missionSystem.state === 'DIALOGUE_ACTIVE') {
        this.missionSystem.state = 'IDLE';
      }
    }
    this.currentMission = null;
    this.missionSystem = null; // Release reference to prevent stale callback leaks
  }
}
