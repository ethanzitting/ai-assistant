export function createSuccessfulCallGate(maxSuccessfulCalls: number) {
  let activeTraceId: string | null = null;
  let successfulCalls = 0;

  function selectTrace(traceId: string): void {
    if (activeTraceId === traceId) return;
    activeTraceId = traceId;
    successfulCalls = 0;
  }

  return {
    isBlocked(traceId: string): boolean {
      selectTrace(traceId);
      return successfulCalls >= maxSuccessfulCalls;
    },
    recordSuccess(traceId: string): void {
      selectTrace(traceId);
      successfulCalls++;
    },
  };
}
