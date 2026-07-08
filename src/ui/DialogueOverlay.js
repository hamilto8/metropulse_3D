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

    this.currentMission = null;
    this.missionSystem = null;
    this.currentNodeId = 'start';

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.hide());
    }
  }

  showMissionDialogue(mission, missionSystem) {
    if (!this.overlay || !mission) return;
    this.currentMission = mission;
    this.missionSystem = missionSystem;
    this.currentNodeId = 'start';

    this.renderNode(this.currentNodeId);
    this.overlay.classList.remove('hidden');
  }

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

    // Check action execution
    if (node.action === 'START_MISSION') {
      const startBtn = document.createElement('button');
      startBtn.className = 'dialogue-choice-btn';
      startBtn.textContent = '🚕 Start Ride / Let\'s Go!';
      startBtn.addEventListener('click', () => {
        this.hide();
        if (this.missionSystem) {
          this.missionSystem.startMission(this.currentMission, node);
        }
      });
      this.choicesEl.appendChild(startBtn);
      return;
    }

    if (node.action === 'DECLINE') {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'dialogue-choice-btn';
      closeBtn.textContent = '👋 Close';
      closeBtn.addEventListener('click', () => {
        this.hide();
      });
      this.choicesEl.appendChild(closeBtn);
      return;
    }

    // Render interactive choices
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

  hide() {
    if (this.overlay) {
      this.overlay.classList.add('hidden');
    }
    if (this.missionSystem) {
      this.missionSystem.triggerCooldown = 4.0;
    }
    this.currentMission = null;
  }
}
