const test = require('node:test')
const assert = require('node:assert/strict')
const CommandQueue = require('../src/scheduler/CommandQueue')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('an invalid repeating queue exits instead of spinning forever', async () => {
  const notices = []
  const queue = new CommandQueue({
    notify: (message) => notices.push(message),
    repeatDelayMs: 5
  })

  const result = await queue.run(
    'unknown command then repeat',
    {},
    () => null
  )

  assert.equal(result, false)
  assert.equal(notices.length, 1)
})

test('a fast repeating command yields and remains stoppable', async () => {
  let executions = 0
  const queue = new CommandQueue({ repeatDelayMs: 5 })
  const match = () => ({
    args: '',
    timeoutMs: 100,
    handler: async () => {
      executions += 1
    }
  })

  const running = queue.run('tick repeat', {}, match)
  await sleep(25)
  await queue.stop()
  await running

  assert.ok(executions >= 1)
  assert.ok(executions < 20)
})

test('a timeout cancels active work and stops the queue', async () => {
  let cancellations = 0
  let secondStepExecutions = 0
  const errors = []
  const queue = new CommandQueue({
    cancelActiveWork: async () => {
      cancellations += 1
    },
    onError: (label, error, timedOut) => {
      errors.push({ label, error, timedOut })
    }
  })

  const match = (segment) => ({
    args: '',
    timeoutMs: 10,
    handler: segment === 'slow'
      ? () => new Promise(() => {})
      : async () => { secondStepExecutions += 1 }
  })

  const result = await queue.run('slow then second', {}, match)

  assert.equal(result, false)
  assert.equal(cancellations, 1)
  assert.equal(secondStepExecutions, 0)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].timedOut, true)
})

test('a newer command cancels the running command before starting', async () => {
  let cancellations = 0
  let oldSecondStep = 0
  let newExecutions = 0
  const queue = new CommandQueue({
    cancelActiveWork: async () => {
      cancellations += 1
    }
  })

  const match = (segment) => ({
    args: '',
    timeoutMs: 1000,
    handler: async (args, context) => {
      if (segment === 'slow') {
        await new Promise((resolve) => {
          context.signal.addEventListener('abort', resolve, { once: true })
        })
      } else if (segment === 'old-second') {
        oldSecondStep += 1
      } else {
        newExecutions += 1
      }
    }
  })

  const oldRun = queue.run('slow then old-second', {}, match)
  await sleep(10)
  const newRun = queue.run('new', {}, match)

  await Promise.all([oldRun, newRun])

  assert.equal(cancellations, 1)
  assert.equal(oldSecondStep, 0)
  assert.equal(newExecutions, 1)
})
