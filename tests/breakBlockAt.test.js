const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const breakBlockAt = require('../src/world/breakBlockAt')

test('break_block_at converts plain coordinates to Vec3 and verifies removal', async () => {
  let present = true
  let receivedPosition = null
  const block = { name: 'cobblestone', boundingBox: 'block' }
  const bot = {
    entity: { position: new Vec3(1, 64, 1) },
    blockAt(position) {
      receivedPosition = position
      return present ? { ...block, position } : { name: 'air', boundingBox: 'empty', position }
    },
    canDigBlock: () => true,
    dig: async () => { present = false }
  }

  const result = await breakBlockAt(bot, { x: 2, y: 64, z: 1 })

  assert.ok(receivedPosition instanceof Vec3)
  assert.equal(result.broken, true)
  assert.equal(result.block, 'cobblestone')
  assert.deepEqual(result.position, { x: 2, y: 64, z: 1 })
})

test('break_block_at rejects malformed coordinates without calling Mineflayer', async () => {
  await assert.rejects(
    breakBlockAt({}, { x: 1, y: 2 }),
    /finite x, y, and z/
  )
})
