/**
 * DialogueOverlay.js
 * MVC/MVVM-based dialogue parser and UI modal controller for MetroPulse 3D missions.
 * Renders branching JSON dialogue trees, avatars, animated text, and interactive choices.
 */
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

    if (this.avatarEl) this.avatarEl.textContent = this.currentMission.avatar || '👔';
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
        const mission = this.currentMission;
        this.hide();
        if (this.missionSystem) {
          this.missionSystem.startMission(mission, node);
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
          this.renderNode(choice.next);
        });
        this.choicesEl.appendChild(btn);
      });
    }
  }

  /**
   * Hides the dialogue overlay and resets all state.
   * Notifies MissionSystem to start the re-trigger cooldown timer.
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
