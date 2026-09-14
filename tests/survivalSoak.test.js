const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseArgs,
  summarizeSamples,
  runSoak
} = require('../scripts/survival-soak')

test('soak arguments and summary enforce survival criteria', () => {
  assert.deepEqual(
    parseArgs(['--minutes', '120', '--interval', '60', '--max-deaths', '1']),
    {
      minutes: 120,
      interval: 60,
      output: 'data/survival-soak-latest.json',
      maxDeaths: 1
    }
  )

  const summary = summarizeSamples([
    { ok: true, connected: true, health: 20, food: 20, deathCount: 2 },
    { ok: true, connected: true, health: 10, food: 12, deathCount: 3 }
  ], 0)
  assert.equal(summary.minimumHealth, 10)
  assert.equal(summary.newDeaths, 1)
  assert.equal(summary.passed, false)
})

test('soak runner polls all body endpoints with an injectable clock', async () => {
  let clock = 0
  const endpoints = []
  const fetchImpl = async (url) => {
    const endpoint = new URL(url).pathname
    endpoints.push(endpoint)
    const data = endpoint === '/health'
      ? { connected: true }
      : endpoint === '/status'
        ? { health: 20, food: 20, position: { x: 1, y: 2, z: 3 } }
        : endpoint === '/inventory'
          ? []
          : endpoint === '/task'
            ? null
            : []
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data })
    }
  }

  const report = await runSoak({
    minutes: 0.001,
    interval: 0.03,
    maxDeaths: 0,
    output: null,
    fetchImpl,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds }
  })

  assert.equal(report.summary.passed, true)
  assert.equal(report.summary.samples, 2)
  for (const endpoint of ['/health', '/status', '/inventory', '/task', '/deaths']) {
    assert.ok(endpoints.includes(endpoint))
  }
})
