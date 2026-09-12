const TaskScheduler = require('../src/scheduler/TaskScheduler')

const scheduler = new TaskScheduler()

scheduler.setTask({
  type: 'mining',
  priority: 300
})

scheduler.setTask({
  type: 'combat',
  priority: 900
})

console.log('Current:', scheduler.getCurrentTask())

scheduler.clearTask()
scheduler.resumePreviousTask()

console.log('Resumed:', scheduler.getCurrentTask())