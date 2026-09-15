#!/usr/bin/env node
const baseUrl = (
  process.env.EARL_API_URL ||
  process.env.MC_API_URL ||
  'http://127.0.0.1:3001'
).replace(/\/$/, '')
const token = process.env.EARL_API_TOKEN || ''

function usage(message) {
  if (message) console.error(message)
  console.error([
    'Usage: node bin/mc.js <command> [arguments]',
    'Observe: status, inventory, nearby [range], scene [range], skills',
    'Messages: read_chat, commands, wait [seconds], listen, claim ID, complete ID [result]',
    '          chat MESSAGE',
    'Actions: follow PLAYER, collect BLOCK COUNT, craft ITEM COUNT, goto X Y Z',
    '         fight MOB, flee [distance], eat, pickup [count], sleep',
    '         recipes ITEM, use BLOCK, seeds [count], farm CROP COUNT, smelt ITEM COUNT [fuel]',
    'Locations: mark NAME, marks, go_mark NAME, unmark NAME',
    'Recovery: deaths, deathpoint, task, cancel',
    'Procedures: procedures [status], procedure_stage JSON, procedure_approve ID',
    '            procedure_reject ID REASON, procedure_run ID',
    'Generic: exec SKILL JSON, bg SKILL JSON'
  ].join('\n'))
  process.exitCode = 2
}

function integer(value, fallback) {
  if (value === undefined && fallback !== undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`Expected integer, got ${value}.`)
  return parsed
}

async function request(method, path, body) {
  const headers = { accept: 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false) {
    const error = payload.error || {}
    throw new Error(error.message || `Earl API returned HTTP ${response.status}.`)
  }
  return payload.data === undefined ? payload : payload.data
}

async function execute(skill, input, background = false) {
  return request('POST', '/execute', {
    skill,
    input,
    background,
    requestedBy: 'hermes'
  })
}

async function main() {
  const [command = '', ...args] = process.argv.slice(2)

  switch (command.toLowerCase()) {
    case 'health':
      return request('GET', '/health')
    case 'status':
      return request('GET', '/status')
    case 'inventory':
    case 'inv':
      return request('GET', '/inventory')
    case 'nearby':
      return request('GET', `/nearby?range=${integer(args[0], 16)}`)
    case 'scene':
      return request('GET', `/scene?range=${integer(args[0], 16)}`)
    case 'skills':
      return request('GET', '/skills')
    case 'read_chat':
      return request('GET', `/chat?after=${integer(args[0], 0)}`)
    case 'commands':
      return request('GET', '/commands')
    case 'wait':
    case 'wait_command':
      return request(
        'GET',
        `/commands/wait?timeout=${integer(args[0], 25)}`
      )
    case 'listen':
      while (true) {
        const commands = await request('GET', '/commands/wait?timeout=25')
        if (commands.length > 0) return commands
      }
    case 'claim':
      if (!args[0]) return usage('claim requires a command id.')
      return request('POST', `/commands/${integer(args[0])}/claim`, {})
    case 'complete':
    case 'complete_command':
      if (!args[0]) return usage('complete requires a command id.')
      return request('POST', `/commands/${integer(args[0])}/complete`, {
        result: args.slice(1).join(' ') || null
      })
    case 'fail':
      if (!args[0]) return usage('fail requires a command id.')
      return request('POST', `/commands/${integer(args[0])}/fail`, {
        error: args.slice(1).join(' ') || 'Hermes could not complete the request.'
      })
    case 'chat':
    case 'say':
      if (args.length === 0) return usage('chat requires a message.')
      return request('POST', '/action/chat', { message: args.join(' ') })
    case 'task':
      return request('GET', '/task')
    case 'tasks':
      return request('GET', '/tasks')
    case 'cancel':
    case 'stop':
      return request('POST', '/cancel', {})
    case 'procedures':
      return request('GET', `/procedures?status=${args[0] || 'all'}`)
    case 'procedure_stage': {
      if (args.length === 0) return usage('procedure_stage requires JSON.')
      let definition
      try {
        definition = JSON.parse(args.join(' '))
      } catch {
        throw new Error('Procedure definition must be valid JSON.')
      }
      return request('POST', '/procedures/stage', definition)
    }
    case 'procedure_approve':
      if (!args[0]) return usage('procedure_approve requires an id.')
      return request('POST', `/procedures/${integer(args[0])}/approve`, {
        reviewedBy: process.env.USERNAME || process.env.USER || 'player'
      })
    case 'procedure_reject':
      if (!args[0]) return usage('procedure_reject requires an id.')
      return request('POST', `/procedures/${integer(args[0])}/reject`, {
        reason: args.slice(1).join(' ') || 'rejected by player',
        reviewedBy: process.env.USERNAME || process.env.USER || 'player'
      })
    case 'procedure_run':
      if (!args[0]) return usage('procedure_run requires an id.')
      return request('POST', `/procedures/${integer(args[0])}/execute`, {
        requestedBy: 'hermes'
      })
    case 'follow':
      if (!args[0]) return usage('follow requires a player.')
      return execute('follow_player', { player: args[0] })
    case 'collect':
      if (!args[0]) return usage('collect requires a block and count.')
      return execute('gather_block', {
        block: args[0],
        amount: integer(args[1], 1)
      })
    case 'bg_collect':
      if (!args[0]) return usage('bg_collect requires a block and count.')
      return execute('gather_block', {
        block: args[0],
        amount: integer(args[1], 1)
      }, true)
    case 'craft':
    case 'make':
      if (!args[0]) return usage('craft requires an item and count.')
      return execute('make_item', {
        item: args[0],
        amount: integer(args[1], 1)
      })
    case 'goto':
      if (args.length < 3) return usage('goto requires X Y Z.')
      return execute('go_to', {
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      })
    case 'bg_goto':
      if (args.length < 3) return usage('bg_goto requires X Y Z.')
      return execute('go_to', {
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }, true)
    case 'fight':
    case 'attack':
      return execute('attack_hostile', {
        mob: args[0] || 'zombie',
        maxDistance: integer(args[1], 16)
      })
    case 'flee':
      return execute('flee_from_hostiles', {
        distance: integer(args[0], 16)
      })
    case 'eat':
      return execute('eat_now', {})
    case 'pickup':
      return execute('pickup_items', {
        maxDistance: 16,
        maxItems: integer(args[0], 16)
      })
    case 'sleep':
      return execute('sleep_in_bed', {})
    case 'recipes':
      if (!args[0]) return usage('recipes requires an item.')
      return execute('get_recipes', { item: args[0] })
    case 'use':
    case 'interact':
      if (!args[0]) return usage('use requires a block.')
      return execute('use_nearby_block', {
        block: args[0],
        maxDistance: 16
      })
    case 'seeds':
    case 'gather_seeds':
      return execute('gather_seeds', {
        amount: integer(args[0], 1),
        maxDistance: integer(args[1], 32)
      }, true)
    case 'farm':
    case 'harvest':
      if (!args[0]) return usage('farm requires a crop and amount.')
      return execute('farm_crops', {
        crop: args[0],
        amount: integer(args[1], 1)
      })
    case 'farm_all':
      return execute('farm_all_available', { crop: args[0] || 'all' })
    case 'smelt':
      if (!args[0]) return usage('smelt requires an item and amount.')
      return execute('smelt_item', {
        item: args[0],
        amount: integer(args[1], 1),
        ...(args[2] ? { fuel: args[2] } : {})
      }, true)
    case 'mark':
      if (args.length === 0) return usage('mark requires a name.')
      return execute('mark_location', { name: args.join(' ') })
    case 'marks':
    case 'locations':
      return request('GET', '/locations')
    case 'go_mark':
      if (args.length === 0) return usage('go_mark requires a name.')
      return execute('go_to_location', { name: args.join(' ') }, true)
    case 'unmark':
      if (args.length === 0) return usage('unmark requires a name.')
      return execute('forget_location', { name: args.join(' ') })
    case 'deaths':
      return request('GET', '/deaths')
    case 'deathpoint':
      return execute('return_to_death', {}, true)
    case 'exec':
    case 'bg': {
      if (!args[0]) return usage(`${command} requires a skill name.`)
      let input = {}
      if (args[1]) {
        try {
          input = JSON.parse(args.slice(1).join(' '))
        } catch {
          throw new Error('The skill input must be valid JSON.')
        }
      }
      return execute(args[0], input, command === 'bg')
    }
    default:
      usage()
      return null
  }
}

main().then((result) => {
  if (result !== undefined && result !== null) {
    console.log(JSON.stringify(result, null, 2))
  }
}).catch((error) => {
  console.error(`mc: ${error.message}`)
  process.exitCode = 1
})
