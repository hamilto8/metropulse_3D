/**
 * Small synchronous transaction for cross-system world edits. Each step
 * registers its compensation before applying, so even a step that throws
 * after a partial mutation is included in reverse-order rollback.
 */
export class WorldEditTransaction {
  constructor(label = 'world-edit') {
    this.label = label;
    this.state = 'ACTIVE';
    this.compensations = [];
  }

  step(label, apply, compensate = () => {}) {
    if (this.state !== 'ACTIVE') throw new Error(`${this.label} transaction is ${this.state.toLowerCase()}`);
    if (typeof apply !== 'function' || typeof compensate !== 'function') {
      throw new TypeError('transaction steps require apply and compensate functions');
    }
    const entry = { label, compensate, value: undefined };
    this.compensations.push(entry);
    entry.value = apply();
    if (entry.value === false) {
      // `false` is the participant contract for a rejection without mutation.
      // Thrown errors retain the pre-registered compensation because a throw
      // may happen after a partial mutation.
      this.compensations.pop();
      throw new Error(`${label} rejected the ${this.label} transaction`);
    }
    return entry.value;
  }

  commit() {
    if (this.state !== 'ACTIVE') throw new Error(`${this.label} transaction is ${this.state.toLowerCase()}`);
    this.state = 'COMMITTED';
    this.compensations.length = 0;
    return true;
  }

  rollback(cause = null) {
    if (this.state !== 'ACTIVE') return [];
    const errors = [];
    for (let index = this.compensations.length - 1; index >= 0; index--) {
      const entry = this.compensations[index];
      try {
        entry.compensate(entry.value, cause);
      } catch (error) {
        errors.push({ step: entry.label, error });
      }
    }
    this.compensations.length = 0;
    this.state = 'ROLLED_BACK';
    return errors;
  }
}

export function runWorldEditTransaction(label, executor) {
  if (typeof executor !== 'function') throw new TypeError('transaction executor must be a function');
  const transaction = new WorldEditTransaction(label);
  try {
    const value = executor(transaction);
    transaction.commit();
    return value;
  } catch (error) {
    const rollbackErrors = transaction.rollback(error);
    if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors;
    throw error;
  }
}
