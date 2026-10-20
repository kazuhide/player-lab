const GIB = 1024 ** 3;

/** Keep independent correctness files within a CPU and estimated memory budget. */
export function workerBudget(parallelism: number, availableBytes: number, requested?: string): number {
  const cpu = Number.isInteger(parallelism) && parallelism > 0 ? parallelism : 1;
  const memory = Number.isFinite(availableBytes) && availableBytes > 0
    ? Math.max(1, Math.floor((availableBytes - GIB) / (2 * GIB))) : 1;
  const capacity = Math.min(4, cpu, memory);
  if (requested === undefined) return capacity;
  if (!/^[1-9]\d*$/.test(requested) || !Number.isSafeInteger(Number(requested))) {
    throw new Error("E2E_WORKERS must be a positive integer.");
  }
  return Math.min(capacity, Number(requested));
}
