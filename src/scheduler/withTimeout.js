class ActionTimeoutError extends Error {
  constructor(label, ms) {
    super(`"${label}" timed out after ${ms}ms`)
    this.name = 'ActionTimeoutError'
    this.code = 'ACTION_TIMEOUT'
  }
}

function withTimeout(promise, ms, label, options = {}) {
  const { onTimeout } = options

  return new Promise((resolve, reject) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true

      const error = new ActionTimeoutError(label, ms)

      Promise.resolve()
        .then(() => onTimeout && onTimeout(error))
        .catch((cleanupError) => {
          console.error(
            `Timeout cleanup failed for "${label}": ${cleanupError.message}`
          )
        })
        .finally(() => reject(error))
    }, ms)

    Promise.resolve(promise).then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

withTimeout.ActionTimeoutError = ActionTimeoutError

module.exports = withTimeout
