const OPENABLE_PATTERN = /(?:_door|_fence_gate)$/

function isHandOperable(block) {
  if (!block || !OPENABLE_PATTERN.test(block.name)) return false
  if (block.name === 'iron_door') return false

  return true
}

function blockProperties(block) {
  return block && typeof block.getProperties === 'function'
    ? block.getProperties() || {}
    : {}
}

function isHandOpenable(block) {
  if (!isHandOperable(block)) return false

  const properties = blockProperties(block)

  return properties.open === false
}

function resolveDoorBase(bot, block) {
  if (!block || !/_door$/.test(block.name)) return block
  if (blockProperties(block).half !== 'upper') return block

  const lower = bot.blockAt(block.position.offset(0, -1, 0))
  return lower && lower.name === block.name ? lower : block
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

async function waitForDoorState(bot, position, open, timeoutMs = 750) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const current = bot.blockAt(position)
    const properties = blockProperties(current)

    if (properties.open === open) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  return false
}

async function waitForOpenState(bot, position, timeoutMs = 750) {
  return waitForDoorState(bot, position, true, timeoutMs)
}

class DoorOpener {
  constructor(bot, options = {}) {
    this.bot = bot
    this.radius = options.radius || 3
    this.tickInterval = options.tickInterval || 4
    this.cooldownMs = options.cooldownMs || 1000
    this.stateTimeoutMs = options.stateTimeoutMs || 750
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
    const candidates = new Map()

    for (let x = -this.radius; x <= this.radius; x += 1) {
      for (let y = -1; y <= 2; y += 1) {
        for (let z = -this.radius; z <= this.radius; z += 1) {
          const block = this.bot.blockAt(origin.offset(x, y, z))
          if (!isHandOpenable(block)) continue

          const base = resolveDoorBase(this.bot, block)

          const distance = this.bot.entity.position.distanceTo(
            base.position.offset(0.5, 0.5, 0.5)
          )

          if (distance <= 4.5) {
            const key = `${base.position.x},${base.position.y},${base.position.z}`
            const previous = candidates.get(key)
            if (!previous || distance < previous.distance) {
              candidates.set(key, { block: base, distance })
            }
          }
        }
      }
    }

    const ordered = [...candidates.values()]
      .sort((a, b) => a.distance - b.distance)
    return ordered.length > 0 ? ordered[0].block : null
  }

  async setOpen(block, open) {
    const target = resolveDoorBase(this.bot, block)
    if (!isHandOperable(target)) {
      throw new Error(`${target ? target.name : 'block'} cannot be opened by hand`)
    }

    if (blockProperties(target).open === open) return true

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await this.bot.activateBlock(
        target,
        horizontalFace(this.bot, target)
      )
      if (await waitForDoorState(
        this.bot,
        target.position,
        open,
        this.stateTimeoutMs
      )) return true
    }

    throw new Error(
      `the server did not confirm ${target.name} ${open ? 'opened' : 'closed'}`
    )
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
      await this.setOpen(block, true)
      if (this.onOpened) await this.onOpened(block)
      console.log(`Earl opened ${block.name} for movement.`)
      return true
    } finally {
      this.busy = false
    }
  }
}

module.exports = DoorOpener
module.exports.blockProperties = blockProperties
module.exports.isHandOpenable = isHandOpenable
module.exports.isHandOperable = isHandOperable
module.exports.horizontalFace = horizontalFace
module.exports.resolveDoorBase = resolveDoorBase
module.exports.waitForDoorState = waitForDoorState
module.exports.waitForOpenState = waitForOpenState
