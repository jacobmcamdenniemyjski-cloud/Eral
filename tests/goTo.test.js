const test = require('node:test')
const assert = require('node:assert/strict')
const goTo = require('../src/movement/goTo')

test('goto uses a real two-block tolerance', async () => {
  let receivedGoal
  const bot = {
    entity: {
      position: { x: 11, y: 64, z: 10 }
    },
    pathfinder: {
      async goto(goal) {
        receivedGoal = goal
      }
    }
  }

  const result = await goTo(bot, 10, 64, 10, { tolerance: 2 })

  assert.equal(result, true)
  assert.equal(receivedGoal.constructor.name, 'GoalNear')
  assert.equal(receivedGoal.rangeSq, 4)
})

test('goto rejects when pathfinder finishes outside tolerance', async () => {
  const bot = {
    entity: {
      position: { x: 20, y: 64, z: 10 }
    },
    pathfinder: {
      async goto() {}
    }
  }

  await assert.rejects(
    goTo(bot, 10, 64, 10, { tolerance: 2 }),
    /still 10.0 blocks away/
  )
})
