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
  assert.equal(store.advance(plan.id, 'floor').phase, 'floor')
})
