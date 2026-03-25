export function useLatestRequestGuard() {
  let activeRequestId = 0;

  function start() {
    activeRequestId += 1;
    return activeRequestId;
  }

  function isCurrent(requestId: number) {
    return requestId === activeRequestId;
  }

  function invalidate() {
    activeRequestId += 1;
  }

  return {
    start,
    isCurrent,
    invalidate,
  };
}
