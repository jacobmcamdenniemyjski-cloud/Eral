const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const BuildPlanStore = require('../src/building/BuildPlanStore')

const definition = {
  origin: { x: 10, y: 64, z: 20 },
  width: 7,
  depth: 7,
  interiorHeight: 3,
  doorPosition: { x: 13, y: 65, z: 20 }
}

test('build plans persist locked geometry and pause active work after restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'earl-plans-'))
  const filePath = path.join(directory, 'plans.json')
  try {
    const first = new BuildPlanStore({ filePath })
    const created = first.create(definition, { material: 'oak_planks' })
    first.advance(created.id, 'site_ready', 'verified clear')

    const restarted = new BuildPlanStore({ filePath })
    const recovered = restarted.get(created.id)
    assert.equal(recovered.status, 'paused')
    assert.equal(recovered.phase, 'site_ready')
    assert.equal(recovered.recoveryCount, 1)
    assert.deepEqual(recovered.definition, definition)
    assert.throws(
      () => restarted.assertGeometry(created.id, {
        ...definition,
        origin: { x: 10, y: 65, z: 20 }
      }),
      (error) => error.code === 'BUILD_PLAN_DRIFT'
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('build phases cannot skip unverified construction stages', () => {
  const store = new BuildPlanStore()
  const plan = store.create(definition)
  assert.throws(
    () => store.advance(plan.id, 'walls'),
    (error) => error.code === 'BUILD_PHASE_SKIPPED'
  )
  assert.equal(store.advance(plan.id, 'site_ready').phase, 'site_ready')
  assert.throws(
    () => store.advance(plan.id, 'floor'),
    (error) => error.code === 'BUILD_PHASE_INCOMPLETE'
  )
  for (let x = 10; x < 17; x += 1) {
    for (let z = 20; z < 27; z += 1) {
      store.recordPosition(plan.id, { x, y: 64, z }, {
        phase: 'floor',
        block: 'oak_planks'
      })
    }
  }
  assert.equal(store.advance(plan.id, 'floor').phase, 'floor')
})

test('build plans protect their envelope and require explicit resume or abort', () => {
  const store = new BuildPlanStore()
  const plan = store.create(definition)
  assert.equal(store.findProtectingPlan({ x: 12, y: 65, z: 22 }).id, plan.id)
  assert.equal(store.findProtectingPlan({ x: 100, y: 65, z: 100 }), null)

  store.pause(plan.id, 'test pause')
  assert.equal(store.resume(plan.id, 'world inspected').status, 'active')
  const aborted = store.abort(plan.id, 'obsolete test plan')
  assert.equal(aborted.status, 'failed')
  assert.equal(aborted.outcome.aborted, true)
  assert.equal(store.findProtectingPlan({ x: 12, y: 65, z: 22 }), null)
})
