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
    'Messages: read_chat, commands [status], wait [seconds], listen, claim ID, complete ID [result]',
    '          recover ID, fail ID [reason], chat MESSAGE',
    'Actions: follow PLAYER, collect BLOCK COUNT, craft ITEM COUNT, goto X Y Z',
    '         fight MOB, flee [distance], eat, pickup [count], sleep',
    '         recipes ITEM, use BLOCK, door [close|test], seeds [count], farm CROP COUNT',
    '         create_farm CROP X Y Z WIDTH DEPTH, inspect_block X Y Z',
    '         break_block X Y Z EXPECTED_BLOCK',
    'Building: plan_create JSON, plan_get ID, plan_advance ID PHASE [NOTE]',
    '          plan_place ID PHASE BLOCK X Y Z, plan_resume ID REASON, plan_abort ID REASON',
    '          inspect_site X Y Z WIDTH DEPTH [MARGIN], clear_site X Y Z WIDTH DEPTH [MARGIN]',
    '          build_plan JSON, inspect_shelter JSON',
    '          smelt ITEM COUNT [fuel]',
    'Locations: mark NAME, marks, go_mark NAME, unmark NAME',
    'Recovery: deaths, deathpoint, recovery, recovery_clear, task, actions, build_plans [status], cancel',
    'Autonomy: autonomy, autonomy_candidates, autonomy_on, autonomy_off, autonomy_tick',
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
    case 'autonomy':
      return request('GET', '/autonomy')
    case 'autonomy_candidates':
      return request('GET', '/autonomy/candidates')
    case 'autonomy_on':
      return request('POST', '/autonomy/enable', {})
    case 'autonomy_off':
      return request('POST', '/autonomy/disable', {})
    case 'autonomy_tick':
      return request('POST', '/autonomy/tick', {})
    case 'read_chat':
      return request('GET', `/chat?after=${integer(args[0], 0)}`)
    case 'commands':
      return request('GET', `/commands?status=${args[0] || 'pending'}`)
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
    case 'recover':
    case 'resume_command':
      if (!args[0]) return usage('recover requires a command id.')
      return request('POST', `/commands/${integer(args[0])}/resume`, {})
    case 'chat':
    case 'say':
      if (args.length === 0) return usage('chat requires a message.')
      return request('POST', '/action/chat', { message: args.join(' ') })
    case 'task':
      return request('GET', '/task')
    case 'actions':
      return request('GET', '/actions')
    case 'build_plans':
      return request('GET', `/build-plans?status=${args[0] || 'all'}`)
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
    case 'inspect_block':
      if (args.length < 3) return usage('inspect_block requires X Y Z.')
      return execute('inspect_block_at', {
        position: {
          x: integer(args[0]),
          y: integer(args[1]),
          z: integer(args[2])
        }
      })
    case 'break_block':
      if (args.length < 4) {
        return usage('break_block requires X Y Z EXPECTED_BLOCK.')
      }
      return execute('break_block_at', {
        position: {
          x: integer(args[0]),
          y: integer(args[1]),
          z: integer(args[2])
        },
        expectedBlock: args[3]
      })
    case 'door':
    case 'traverse_door':
      return execute('traverse_nearby_door', {
        maxDistance: 16,
        closeBehind: ['close', 'test'].includes(
          String(args[0] || '').toLowerCase()
        ),
        returnThrough: String(args[0] || '').toLowerCase() === 'test'
      })
    case 'inspect_site':
      if (args.length < 5) {
        return usage('inspect_site requires X Y Z WIDTH DEPTH [MARGIN].')
      }
      return execute('inspect_build_site', {
        origin: {
          x: integer(args[0]),
          y: integer(args[1]),
          z: integer(args[2])
        },
        width: integer(args[3]),
        depth: integer(args[4]),
        ...(args[5] === undefined ? {} : { margin: integer(args[5]) })
      })
    case 'clear_site':
      if (args.length < 5) {
        return usage('clear_site requires X Y Z WIDTH DEPTH [MARGIN].')
      }
      return execute('clear_build_site', {
        origin: {
          x: integer(args[0]),
          y: integer(args[1]),
          z: integer(args[2])
        },
        width: integer(args[3]),
        depth: integer(args[4]),
        ...(args[5] === undefined ? {} : { margin: integer(args[5]) })
      }, true)
    case 'plan_create': {
      if (args.length === 0) return usage('plan_create requires JSON.')
      let plan
      try {
        plan = JSON.parse(args.join(' '))
      } catch {
        throw new Error('Building plan must be valid JSON.')
      }
      return execute('create_build_plan', plan)
    }
    case 'plan_get':
      if (!args[0]) return usage('plan_get requires an id.')
      return execute('get_build_plan', { id: integer(args[0]) })
    case 'plan_advance':
      if (args.length < 2) return usage('plan_advance requires ID PHASE [NOTE].')
      return execute('advance_build_plan', {
        id: integer(args[0]),
        phase: args[1],
        ...(args.length > 2 ? { note: args.slice(2).join(' ') } : {})
      })
    case 'plan_place':
      if (args.length < 6) {
        return usage('plan_place requires ID PHASE BLOCK X Y Z.')
      }
      return execute('place_build_plan_block', {
        id: integer(args[0]),
        phase: args[1],
        block: args[2],
        position: {
          x: integer(args[3]),
          y: integer(args[4]),
          z: integer(args[5])
        }
      })
    case 'plan_resume':
      if (args.length < 2) return usage('plan_resume requires ID REASON.')
      return execute('resume_build_plan', {
        id: integer(args[0]),
        reason: args.slice(1).join(' ')
      })
    case 'plan_abort':
      if (args.length < 2) return usage('plan_abort requires ID REASON.')
      return execute('abort_build_plan', {
        id: integer(args[0]),
        reason: args.slice(1).join(' ')
      })
    case 'plan_site':
      if (!args[0]) return usage('plan_site requires an id.')
      return execute('prepare_build_plan_site', {
        id: integer(args[0]),
        ...(args[1] === undefined ? {} : { margin: integer(args[1]) })
      }, true)
    case 'plan_inspect':
      if (!args[0]) return usage('plan_inspect requires an id.')
      return execute('inspect_build_plan_shelter', { id: integer(args[0]) })
    case 'build_plan':
    case 'inspect_shelter': {
      if (args.length === 0) return usage(`${command} requires JSON.`)
      let plan
      try {
        plan = JSON.parse(args.join(' '))
      } catch {
        throw new Error('Building plan must be valid JSON.')
      }
      return execute(
        command === 'build_plan' ? 'validate_build_plan' : 'inspect_shelter',
        plan
      )
    }
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
    case 'create_farm':
      if (args.length < 6) {
        return usage('create_farm requires CROP X Y Z WIDTH DEPTH.')
      }
      return execute('create_farm', {
        crop: args[0],
        origin: {
          x: integer(args[1]),
          y: integer(args[2]),
          z: integer(args[3])
        },
        width: integer(args[4]),
        depth: integer(args[5])
      }, true)
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
    case 'recovery':
      return execute('get_survival_recovery', {})
    case 'recovery_clear':
      return execute('clear_survival_recovery', {})
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
