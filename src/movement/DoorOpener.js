const OPENABLE_PATTERN = /(?:_door|_fence_gate)$/

function isHandOpenable(block) {
  if (!block || !OPENABLE_PATTERN.test(block.name)) return false
  if (block.name === 'iron_door') return false

  const properties = typeof block.getProperties === 'function'
    ? block.getProperties()
    : {}

  return properties.open === false
}

function horizontalFace(bot, block) {
  const centerX = block.position.x + 0.5
  const centerZ = block.position.z + 0.5
  const dx = bot.entity.position.x - centerX
  const dz = bot.entity.position.z - centerZ

  if (Math.abs(dx) >= Math.abs(dz)) {
    return block.position.offset(dx >= 0 ? 1 : -1, 0, 0)
      .minus(block.position)
  }

  return block.position.offset(0, 0, dz >= 0 ? 1 : -1)
    .minus(block.position)
}

async function waitForOpenState(bot, position, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const current = bot.blockAt(position)
    const properties = current && typeof current.getProperties === 'function'
      ? current.getProperties()
      : {}

    if (properties.open === true) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  return false
}

class DoorOpener {
  constructor(bot, options = {}) {
    this.bot = bot
    this.radius = options.radius || 3
    this.tickInterval = options.tickInterval || 4
    this.cooldownMs = options.cooldownMs || 1000
    this.onOpened = options.onOpened || null
    this.running = false
    this.busy = false
    this.ticks = 0
    this.lastAttempt = new Map()
    this.onPhysicsTick = this.onPhysicsTick.bind(this)
  }

  start() {
    if (this.running) return
    this.running = true
    this.bot.on('physicsTick', this.onPhysicsTick)
  }

  stop() {
    if (!this.running) return
    this.running = false
    this.bot.removeListener('physicsTick', this.onPhysicsTick)
  }

  onPhysicsTick() {
    this.ticks += 1
    if (this.ticks % this.tickInterval !== 0 || this.busy) return

    this.tick().catch((error) => {
      console.error(`Door opening failed: ${error.message}`)
    })
  }

  nearbyDoor() {
    const origin = this.bot.entity.position.floored()
    const candidates = []

    for (let x = -this.radius; x <= this.radius; x += 1) {
      for (let y = -1; y <= 2; y += 1) {
        for (let z = -this.radius; z <= this.radius; z += 1) {
          const block = this.bot.blockAt(origin.offset(x, y, z))
          if (!isHandOpenable(block)) continue

          const distance = this.bot.entity.position.distanceTo(
            block.position.offset(0.5, 0.5, 0.5)
          )

          if (distance <= 4.5) candidates.push({ block, distance })
        }
      }
    }

    candidates.sort((a, b) => a.distance - b.distance)
    return candidates.length > 0 ? candidates[0].block : null
  }

  async tick() {
    if (!this.running || this.busy) return false

    const block = this.nearbyDoor()
    if (!block) return false

    const key = `${block.position.x},${block.position.y},${block.position.z}`
    const lastAttempt = this.lastAttempt.get(key) || 0
    if (Date.now() - lastAttempt < this.cooldownMs) return false

    this.lastAttempt.set(key, Date.now())
    this.busy = true

    try {
      await this.bot.activateBlock(block, horizontalFace(this.bot, block))
      await waitForOpenState(this.bot, block.position)
      if (this.onOpened) await this.onOpened(block)
      console.log(`Earl opened ${block.name} while following.`)
      return true
    } finally {
      this.busy = false
    }
  }
}

module.exports = DoorOpener
module.exports.isHandOpenable = isHandOpenable
module.exports.horizontalFace = horizontalFace
module.exports.waitForOpenState = waitForOpenState
