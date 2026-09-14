function createThrottle(intervalMs) {
  let nextFreeAt = 0;
  const min = Math.max(0, intervalMs);
  return async function throttle() {
    const now = Date.now();
    const start = Math.max(now, nextFreeAt);
    nextFreeAt = start + min;
    const wait = start - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };
}

module.exports = { createThrottle };