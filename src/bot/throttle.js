function createThrottle(intervalMs) {
  let interval = Math.max(0, intervalMs);
  let nextFreeAt = 0;

  async function throttle() {
    const now = Date.now();
    const start = Math.max(now, nextFreeAt);
    nextFreeAt = start + interval;
    const idle = start - now;
    if (idle > 0) await new Promise((resolve) => setTimeout(resolve, idle));
  }

  throttle.pause = (ms) => {
    const until = Date.now() + Math.max(0, ms);
    if (until > nextFreeAt) nextFreeAt = until;
  };

  throttle.setInterval = (ms) => {
    interval = Math.max(0, ms);
  };

  throttle.getInterval = () => interval;

  return throttle;
}

module.exports = { createThrottle };