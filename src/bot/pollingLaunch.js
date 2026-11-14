// Starting Telegram long polling across a deploy.
//
// Deployzy starts the new container while the old one is still polling Telegram. Whichever asks for updates second
// makes the other's request fail with "409: Conflict: terminated by other getUpdates request", and Telegraf then
// stops polling and rejects launch(). Before this, every 409 was fatal: if the NEW container lost that race it exited,
// failed its health check and the deploy was rolled back ("New container unhealthy — old version still serving").
//
// Now a freshly started process waits and tries again for its first few minutes (the old container is stopped once
// this one is healthy), while a process that has been running longer still gives way, as before, so a newer deploy
// always takes over and two bots never keep polling side by side.
const PROCESS_START = Date.now();
const YIELD_AFTER_MS = 3 * 60e3;   // after this long a 409 means a newer instance exists: give way
const RETRY_MS = 10e3;

const isConflict = err => !!err && (err.code === 409 || err.response?.error_code === 409 || /terminated by other getUpdates/i.test(err.message || ''));

// bot: a Telegraf instance. In Telegraf 4.16 launch() only settles when polling stops, so this awaits for as long as
// the bot runs, and rejects with the error that stopped it.
async function launchPolling(bot, { log = () => {}, startedAt = PROCESS_START, now = Date.now, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await bot.launch();
    } catch (err) {
      if (!isConflict(err) || now() - startedAt > YIELD_AFTER_MS) throw err;
      log(`Telegram: another bot instance is still polling (deploy overlap) — trying again in ${RETRY_MS / 1000} s (attempt ${attempt})`);
      await wait(RETRY_MS);
    }
  }
}

module.exports = { launchPolling, isConflict, YIELD_AFTER_MS };
