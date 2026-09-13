/**
 * Races a promise against a timer. 
 * Does NOT cancel the underlying work, just stops the queue from waiting on it forever
 *
 * @param {Promise<any>} promise
 * @param {number} ms
 * @param {string} label - used in the timeout error message
 */
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`"${label}" timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

module.exports = withTimeout