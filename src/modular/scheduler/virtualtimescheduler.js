'use strict';

var Scheduler = require('../scheduler');
var PriorityQueue = require('../internal/priorityqueue');
var ScheduledItem = require('./scheduleditem');
var SchedulePeriodicRecursive = require('./scheduleperiodicrecursive');
var errors = require('../internal/errors');
var inherits = require('inherits');

function notImplemented() {
  throw new errors.NotImplementedError();
}

/**
 * Creates a new virtual time scheduler with the specified initial clock value and absolute time comparer.
 *
 * @constructor
 * @param {Number} initialClock Initial value for the clock.
 * @param {Function} comparer Comparer to determine causality of events based on absolute time.
 */
function VirtualTimeScheduler(initialClock, comparer) {
  this.clock = initialClock;
  this.comparer = comparer;
  this.isEnabled = false;
  this.queue = new PriorityQueue(1024);
  Scheduler.call(this);
}

inherits(VirtualTimeScheduler, Scheduler);

var VirtualTimeSchedulerPrototype = VirtualTimeScheduler.prototype;

VirtualTimeSchedulerPrototype.now = function () {
  return this.toAbsoluteTime(this.clock);
};

VirtualTimeSchedulerPrototype.schedule = function (state, action) {
  return this.scheduleAbsolute(state, this.clock, action);
};

VirtualTimeSchedulerPrototype.scheduleFuture = function (state, dueTime, action) {
  var dt = dueTime instanceof Date ?
    this.toRelativeTime(dueTime - this.now()) :
    this.toRelativeTime(dueTime);

  return this.scheduleRelative(state, dt, action);
};

/**
 * Adds a relative time value to an absolute time value.
 * @param {Number} absolute Absolute virtual time value.
 * @param {Number} relative Relative virtual time value to add.
 * @return {Number} Resulting absolute virtual time sum value.
 */
VirtualTimeSchedulerPrototype.add = notImplemented;

/**
 * Converts an absolute time to a number
 * @param {Any} The absolute time.
 * @returns {Number} The absolute time in ms
 */
VirtualTimeSchedulerPrototype.toAbsoluteTime = notImplemented;

/**
 * Converts the TimeSpan value to a relative virtual time value.
 * @param {Number} timeSpan TimeSpan value to convert.
 * @return {Number} Corresponding relative virtual time value.
 */
VirtualTimeSchedulerPrototype.toRelativeTime = notImplemented;

/**
 * Schedules a periodic piece of work by dynamically discovering the scheduler's capabilities. The periodic task will be emulated using recursive scheduling.
 * @param {Mixed} state Initial state passed to the action upon the first iteration.
 * @param {Number} period Period for running the work periodically.
 * @param {Function} action Action to be executed, potentially updating the state.
 * @returns {Disposable} The disposable object used to cancel the scheduled recurring action (best effort).
 */
VirtualTimeSchedulerPrototype.schedulePeriodic = function (state, period, action) {
  var s = new SchedulePeriodicRecursive(this, state, period, action);
  return s.start();
};

/**
 * Schedules an action to be executed after dueTime.
 * @param {Mixed} state State passed to the action to be executed.
 * @param {Number} dueTime Relative time after which to execute the action.
 * @param {Function} action Action to be executed.
 * @returns {Disposable} The disposable object used to cancel the scheduled action (best effort).
 */
VirtualTimeSchedulerPrototype.scheduleRelative = function (state, dueTime, action) {
  var runAt = this.add(this.clock, dueTime);
  return this.scheduleAbsolute(state, runAt, action);
};

/**
 * Starts the virtual time scheduler.
 */
VirtualTimeSchedulerPrototype.start = function () {
  if (!this.isEnabled) {
    this.isEnabled = true;
    do {
      var next = this.getNext();
      if (next !== null) {
        this.comparer(next.dueTime, this.clock) > 0 && (this.clock = next.dueTime);
        next.invoke();
      } else {
        this.isEnabled = false;
      }
    } while (this.isEnabled);
  }
};

/**
 * Stops the virtual time scheduler.
 */
VirtualTimeSchedulerPrototype.stop = function () {
  this.isEnabled = false;
};

/**
 * Advances the scheduler's clock to the specified time, running all work till that point.
 * @param {Number} time Absolute time to advance the scheduler's clock to.
 */
VirtualTimeSchedulerPrototype.advanceTo = function (time) {
  var dueToClock = this.comparer(this.clock, time);
  if (this.comparer(this.clock, time) > 0) { throw new errors.ArgumentOutOfRangeError(); }
  if (dueToClock === 0) { return; }
  if (!this.isEnabled) {
    this.isEnabled = true;
    do {
      var next = this.getNext();
      if (next !== null && this.comparer(next.dueTime, time) <= 0) {
        this.comparer(next.dueTime, this.clock) > 0 && (this.clock = next.dueTime);
        next.invoke();
      } else {
        this.isEnabled = false;
      }
    } while (this.isEnabled);
    this.clock = time;
  }
};

/**
 * Advances the scheduler's clock by the specified relative time, running all work scheduled for that timespan.
 * @param {Number} time Relative time to advance the scheduler's clock by.
 */
VirtualTimeSchedulerPrototype.advanceBy = function (time) {
  var dt = this.add(this.clock, time),
      dueToClock = this.comparer(this.clock, dt);
  if (dueToClock > 0) { throw new errors.ArgumentOutOfRangeError(); }
  if (dueToClock === 0) {  return; }

  this.advanceTo(dt);
};

/**
 * Advances the scheduler's clock by the specified relative time.
 * @param {Number} time Relative time to advance the scheduler's clock by.
 */
VirtualTimeSchedulerPrototype.sleep = function (time) {
  var dt = this.add(this.clock, time);
  if (this.comparer(this.clock, dt) >= 0) { throw new errors.ArgumentOutOfRangeError(); }

  this.clock = dt;
};

/**
 * Gets the next scheduled item to be executed.
 * @returns {ScheduledItem} The next scheduled item.
 */
VirtualTimeSchedulerPrototype.getNext = function () {
  while (this.queue.length > 0) {
    var next = this.queue.peek();
    if (next.isCancelled()) {
      this.queue.dequeue();
    } else {
      return next;
    }
  }
  return null;
};

/**
 * Schedules an action to be executed at dueTime.
 * @param {Mixed} state State passed to the action to be executed.
 * @param {Number} dueTime Absolute time at which to execute the action.
 * @param {Function} action Action to be executed.
 * @returns {Disposable} The disposable object used to cancel the scheduled action (best effort).
 */
VirtualTimeSchedulerPrototype.scheduleAbsolute = function (state, dueTime, action) {
  var self = this;

  function run(scheduler, state1) {
    self.queue.remove(si);
    return action(scheduler, state1);
  }

  var si = new ScheduledItem(this, state, run, dueTime, this.comparer);
  this.queue.enqueue(si);

  return si.disposable;
};

module.exports = VirtualTimeScheduler;
