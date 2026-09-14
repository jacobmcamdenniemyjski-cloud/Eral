#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

function parseArgs(argv) {
  const options = {
    minutes: 60,
    interval: 30,
    output: path.join('data', 'survival-soak-latest.json'),
    maxDeaths: 0
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--minutes') options.minutes = Number(value)
    else if (flag === '--interval') options.interval = Number(value)
    else if (flag === '--output') options.output = value
    else if (flag === '--max-deaths') options.maxDeaths = Number(value)
    else throw new Error(`Unknown soak option: ${flag}`)
    index += 1
  }

  if (!Number.isFinite(options.minutes) || options.minutes <= 0) {
    throw new Error('--minutes must be greater than zero.')
  }
  if (!Number.isFinite(options.interval) || options.interval <= 0) {
    throw new Error('--interval must be greater than zero.')
  }
  if (!Number.isInteger(options.maxDeaths) || options.maxDeaths < 0) {
    throw new Error('--max-deaths must be a non-negative integer.')
  }
  return options
}

async function apiGet(fetchImpl, baseUrl, token, endpoint, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = { accept: 'application/json' }
    if (token) headers.authorization = `Bearer ${token}`
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      headers,
      signal: controller.signal
    })
    const payload = await response.json()
    if (!response.ok || payload.ok === false) {
      const message = payload.error && payload.error.message
      throw new Error(message || `HTTP ${response.status} from ${endpoint}`)
    }
    return payload.data
  } finally {
    clearTimeout(timer)
  }
}

async function collectSample(options) {
  const [health, status, inventory, task, deaths] = await Promise.all([
    apiGet(options.fetchImpl, options.baseUrl, options.token, '/health'),
    apiGet(options.fetchImpl, options.baseUrl, options.token, '/status'),
    apiGet(options.fetchImpl, options.baseUrl, options.token, '/inventory'),
    apiGet(options.fetchImpl, options.baseUrl, options.token, '/task'),
    apiGet(options.fetchImpl, options.baseUrl, options.token, '/deaths')
  ])
  return {
    time: new Date(options.now()).toISOString(),
    ok: true,
    connected: health.connected === true,
    health: Number(status.health),
    food: Number(status.food),
    position: status.position || null,
    inventorySlots: Array.isArray(inventory) ? inventory.length : null,
    task: task || null,
    deathCount: Array.isArray(deaths) ? deaths.length : null
  }
}

function summarizeSamples(samples, maxDeaths = 0) {
  const successful = samples.filter((sample) => sample.ok)
  const deathCounts = successful
    .map((sample) => sample.deathCount)
    .filter(Number.isFinite)
  const initialDeaths = deathCounts.length > 0 ? deathCounts[0] : 0
  const finalDeaths = deathCounts.length > 0
    ? deathCounts[deathCounts.length - 1]
    : initialDeaths
  const values = (key) => successful
    .map((sample) => sample[key])
    .filter(Number.isFinite)
  const healthValues = values('health')
  const foodValues = values('food')
  const summary = {
    samples: samples.length,
    successfulSamples: successful.length,
    apiErrors: samples.filter((sample) => !sample.ok).length,
    disconnectedSamples: successful.filter((sample) => !sample.connected).length,
    newDeaths: Math.max(0, finalDeaths - initialDeaths),
    minimumHealth: healthValues.length ? Math.min(...healthValues) : null,
    minimumFood: foodValues.length ? Math.min(...foodValues) : null
  }
  summary.passed = summary.samples > 0 &&
    summary.apiErrors === 0 &&
    summary.disconnectedSamples === 0 &&
    summary.newDeaths <= maxDeaths
  return summary
}

function saveReport(filePath, report) {
  if (!filePath) return
  const resolved = path.resolve(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const temporary = `${resolved}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, resolved)
}

async function runSoak(options = {}) {
  const now = options.now || Date.now
  const sleep = options.sleep || ((ms) => new Promise(
    (resolve) => setTimeout(resolve, ms)
  ))
  const fetchImpl = options.fetchImpl || fetch
  const baseUrl = (
    options.baseUrl ||
    process.env.EARL_API_URL ||
    'http://127.0.0.1:3001'
  ).replace(/\/$/, '')
  const token = options.token === undefined
    ? process.env.EARL_API_TOKEN || ''
    : options.token
  const minutes = Number(options.minutes || 60)
  const interval = Number(options.interval || 30)
  const maxDeaths = Number(options.maxDeaths || 0)
  const startedMs = now()
  const endMs = startedMs + (minutes * 60 * 1000)
  const samples = []

  do {
    try {
      const sample = await collectSample({
        fetchImpl,
        baseUrl,
        token,
        now
      })
      samples.push(sample)
      if (options.onSample) options.onSample(sample)
    } catch (error) {
      const sample = {
        time: new Date(now()).toISOString(),
        ok: false,
        error: error.name === 'AbortError'
          ? 'Earl API sample timed out.'
          : error.message
      }
      samples.push(sample)
      if (options.onSample) options.onSample(sample)
    }

    const remaining = endMs - now()
    if (remaining > 0) {
      await sleep(Math.min(interval * 1000, remaining))
    }
  } while (now() < endMs)

  const report = {
    version: 1,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(now()).toISOString(),
    configuredMinutes: minutes,
    intervalSeconds: interval,
    maxDeaths,
    summary: summarizeSamples(samples, maxDeaths),
    samples
  }
  saveReport(options.output, report)
  return report
}

if (require.main === module) {
  let cliOptions
  try {
    cliOptions = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`soak: ${error.message}`)
    process.exit(2)
  }

  console.log(
    `Monitoring Earl for ${cliOptions.minutes} minute(s) every ` +
    `${cliOptions.interval} second(s).`
  )
  runSoak({
    ...cliOptions,
    onSample: (sample) => {
      if (!sample.ok) console.log(`[soak] ERROR: ${sample.error}`)
      else {
        console.log(
          `[soak] health=${sample.health} food=${sample.food} ` +
          `connected=${sample.connected} deaths=${sample.deathCount}`
        )
      }
    }
  }).then((report) => {
    console.log(JSON.stringify(report.summary, null, 2))
    console.log(`Report: ${path.resolve(cliOptions.output)}`)
    if (!report.summary.passed) process.exitCode = 1
  }).catch((error) => {
    console.error(`soak: ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  parseArgs,
  apiGet,
  collectSample,
  summarizeSamples,
  runSoak
}
