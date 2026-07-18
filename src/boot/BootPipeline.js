export const BOOT_STAGE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED'
});

export class BootStageError extends Error {
  constructor(stage, cause) {
    super(`Boot stage "${stage.label}" failed: ${cause?.message || String(cause)}`, {
      cause
    });
    this.name = 'BootStageError';
    this.code = cause?.code || 'BOOT_STAGE_FAILED';
    this.stageId = stage.id;
    this.stageLabel = stage.label;
    this.userMessage = cause?.userMessage || cause?.message || 'An unexpected startup check failed.';
    this.actions = Array.isArray(cause?.actions) ? [...cause.actions] : [];
  }
}

function validateStages(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new TypeError('BootPipeline requires at least one stage.');
  }

  const ids = new Set();
  return stages.map((stage, index) => {
    if (!stage || typeof stage !== 'object') {
      throw new TypeError(`Boot stage ${index + 1} must be an object.`);
    }
    if (typeof stage.id !== 'string' || !stage.id.trim() || ids.has(stage.id)) {
      throw new TypeError(`Boot stage id is missing or duplicated: ${stage.id || '<missing>'}`);
    }
    if (typeof stage.label !== 'string' || !stage.label.trim()) {
      throw new TypeError(`Boot stage ${stage.id} requires a label.`);
    }
    if (typeof stage.run !== 'function') {
      throw new TypeError(`Boot stage ${stage.id} requires a run function.`);
    }
    ids.add(stage.id);
    return Object.freeze({ id: stage.id, label: stage.label, run: stage.run });
  });
}

/**
 * Small renderer-independent startup orchestrator. Stages communicate only
 * through immutable prior results, keeping capability, data, storage, and
 * asset policy independently testable and replaceable.
 */
export class BootPipeline {
  constructor({ stages, onProgress = () => {} } = {}) {
    this.stages = Object.freeze(validateStages(stages));
    this.onProgress = onProgress;
    this.running = false;
  }

  report(stage, index, status, error = null) {
    const completed = status === BOOT_STAGE_STATUS.COMPLETE ? index + 1 : index;
    this.onProgress(Object.freeze({
      stageId: stage.id,
      label: stage.label,
      status,
      completed,
      total: this.stages.length,
      progress: completed / this.stages.length,
      error
    }));
  }

  async run() {
    if (this.running) throw new Error('BootPipeline is already running.');
    this.running = true;
    const results = {};

    try {
      for (let index = 0; index < this.stages.length; index += 1) {
        const stage = this.stages[index];
        this.report(stage, index, BOOT_STAGE_STATUS.RUNNING);
        try {
          results[stage.id] = await stage.run(Object.freeze({ ...results }));
        } catch (error) {
          const wrapped = error instanceof BootStageError
            ? error
            : new BootStageError(stage, error);
          this.report(stage, index, BOOT_STAGE_STATUS.FAILED, wrapped);
          throw wrapped;
        }
        this.report(stage, index, BOOT_STAGE_STATUS.COMPLETE);
      }
      return Object.freeze({ ...results });
    } finally {
      this.running = false;
    }
  }
}

export default BootPipeline;
