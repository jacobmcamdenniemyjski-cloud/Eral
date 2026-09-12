class TaskScheduler {
  constructor() {
    this.currentTask = null
  }

  setTask(task) {
    this.currentTask = task
  }

  clearTask() {
    this.currentTask = null
  }

  getCurrentTask() {
    return this.currentTask
  }
}

module.exports = TaskScheduler