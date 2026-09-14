const test = require('node:test')
const assert = require('node:assert/strict')
const ChatBridge = require('../src/bridge/ChatBridge')

test('chat bridge records messages with cursor-based reads', () => {
  const bridge = new ChatBridge({ maxMessages: 2 })
  bridge.recordMessage('Jacob', 'first')
  const second = bridge.recordMessage('Jacob', 'second')
  bridge.recordMessage('Alex', 'third')

  assert.deepEqual(
    bridge.getMessages({ after: second.id }),
    [{
      id: 3,
      time: bridge.getMessages({ after: second.id })[0].time,
      from: 'Alex',
      message: 'third'
    }]
  )
  assert.equal(bridge.getMessages({ after: 0 }).length, 2)
})

test('chat bridge claims and completes queued player requests', () => {
  const bridge = new ChatBridge()
  const queued = bridge.enqueue('Jacob', 'build a cabin')

  assert.equal(queued.status, 'pending')
  assert.equal(bridge.claimCommand(queued.id).status, 'claimed')
  assert.equal(
    bridge.completeCommand(queued.id, 'cabin built').status,
    'completed'
  )
  assert.equal(bridge.getCommands({ status: 'pending' }).length, 0)
  assert.equal(bridge.getCommands({ status: 'completed' })[0].result, 'cabin built')
})


test('waitForCommands sleeps until a new request arrives', async () => {
  const bridge = new ChatBridge()
  const waiting = bridge.waitForCommands({ timeoutMs: 1000 })

  setImmediate(() => bridge.enqueue('jacob', 'build a cabin'))

  const commands = await waiting
  assert.equal(commands.length, 1)
  assert.equal(commands[0].command, 'build a cabin')
})

test('waitForCommands returns immediately when work is pending', async () => {
  const bridge = new ChatBridge()
  bridge.enqueue('jacob', 'follow me')

  const started = Date.now()
  const commands = await bridge.waitForCommands({ timeoutMs: 1000 })

  assert.equal(commands[0].command, 'follow me')
  assert.ok(Date.now() - started < 100)
})
