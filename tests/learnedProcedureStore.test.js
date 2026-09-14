const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const LearnedProcedureStore = require('../src/learning/LearnedProcedureStore')

function createRegistry() {
  return {
    validateInput: (name, input) => {
      if (name !== 'get_status') {
        return {
          ok: false,
          error: { message: `Unknown skill: ${name}` }
        }
      }
      if (Object.keys(input).length > 0) {
        return {
          ok: false,
          error: { message: 'get_status accepts no input.' }
        }
      }
      return { ok: true }
    },
    execute: async (name) => ({
      ok: true,
      skill: name,
      data: { health: 20 }
    })
  }
}

test('learned procedures require approval and persist validated steps', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'earl-procedure-'))
  const filePath = path.join(directory, 'procedures.json')
  try {
    const store = new LearnedProcedureStore({
      skillRegistry: createRegistry(),
      filePath
    })
    const staged = store.stage({
      name: 'check_status',
      description: 'Check current status.',
      steps: [{ skill: 'get_status', input: {} }]
    })
    assert.equal(staged.status, 'pending')
    await assert.rejects(
      store.execute(staged.id),
      (error) => error.code === 'PROCEDURE_NOT_APPROVED'
    )

    const approved = store.approve(staged.id, 'Jacob')
    assert.equal(approved.status, 'approved')
    const result = await store.execute(staged.id)
    assert.equal(result.ok, true)
    assert.equal(result.completedSteps, 1)

    const restarted = new LearnedProcedureStore({
      skillRegistry: createRegistry(),
      filePath
    })
    assert.equal(restarted.find(staged.id).status, 'approved')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('learned procedures reject unknown skills and extra executable fields', () => {
  const store = new LearnedProcedureStore({
    skillRegistry: createRegistry()
  })
  assert.throws(
    () => store.stage({
      name: 'unsafe_step',
      steps: [{ skill: 'shell', input: {}, command: 'rm something' }]
    }),
    /may contain only skill and input/
  )
  assert.throws(
    () => store.stage({
      name: 'unknown_step',
      steps: [{ skill: 'invented_skill', input: {} }]
    }),
    /Unknown skill/
  )
})
