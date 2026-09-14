const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { Vec3 } = require('vec3')
const LocationStore = require('../src/locations/LocationStore')
const {
  goToSavedLocation,
  markCurrentLocation
} = require('../src/locations/locationActions')

test('saved locations persist across store instances', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'earl-locations-'))
  const filePath = path.join(directory, 'locations.json')

  try {
    const first = new LocationStore({ filePath })
    await first.set('Home Base', {
      x: 10.9,
      y: 64.2,
      z: -4.1,
      dimension: 'minecraft:overworld'
    })

    const second = new LocationStore({ filePath })
    assert.deepEqual(await second.get('home base'), {
      name: 'home base',
      x: 10,
      y: 64,
      z: -5,
      dimension: 'minecraft:overworld',
      updatedAt: (await second.get('home base')).updatedAt
    })

    assert.equal((await second.list()).length, 1)
    assert.equal(await second.remove('HOME BASE'), true)
    assert.equal(await second.get('home base'), null)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('location actions mark and travel to stored coordinates', async () => {
  const values = new Map()
  const store = {
    async set(name, value) {
      const location = {
        name: name.toLowerCase(),
        ...value,
        x: Math.floor(value.x),
        y: Math.floor(value.y),
        z: Math.floor(value.z)
      }
      values.set(location.name, location)
      return location
    },
    async get(name) {
      return values.get(name.toLowerCase()) || null
    }
  }
  const bot = {
    entity: { position: new Vec3(12.9, 70.1, -3.2) },
    game: { dimension: 'minecraft:overworld' }
  }

  const marked = await markCurrentLocation(bot, store, 'Home')
  let travelCall
  const reached = await goToSavedLocation(bot, store, 'home', {
    signal: new AbortController().signal,
    travel: async (...args) => {
      travelCall = args
      return true
    }
  })

  assert.equal(marked.name, 'home')
  assert.equal(reached.x, 12)
  assert.deepEqual(travelCall.slice(1, 4), [12, 70, -4])
  assert.equal(travelCall[4].tolerance, 2)
})

test('location travel refuses a saved location in another dimension', async () => {
  const bot = { game: { dimension: 'minecraft:the_nether' } }
  const store = {
    get: async () => ({
      name: 'home',
      x: 0,
      y: 64,
      z: 0,
      dimension: 'minecraft:overworld'
    })
  }

  await assert.rejects(
    goToSavedLocation(bot, store, 'home', {
      travel: async () => true
    }),
    /overworld.*not.*nether/i
  )
})
