/** Priority Queue
 * 
 * @returns {PQueue}
 */
function PQueue() {
	this.data = [];
}
PQueue.prototype.enqueue = function (key, value) {
	for (var i = 0; i < this.data.length; i++) {
		if (this.data[i][0] > key) {
			break;
		}
	}
	this.data.splice(i, 0, [key, value]);
};

PQueue.prototype.dequeue = function () {
	if (this.data.length === 0) {
		return undefined;
	}
	var v = this.data.shift();
	return v[1];
};

/** Simulator Object
 * 
 */
function Sim() {
	this.simTime = 0;
	this.entities = [];
	this.queue = new PQueue();
	this.endTime = 0;
}

Sim.prototype.counter = (function () {
	var value = 1;
	return function () { return value ++; };
}());


Sim.prototype.time = function () {
	return this.simTime;
};

Sim.prototype.sendMessage = function () {
	var sender = this.source;
	var message = this.msg;
	var entities = this.data;
	var sim = sender.sim;
	
	if (!entities) {
		// send to all entities
		for (var i = 0; i < sim.entities.length; i++) {
			var entity = sim.entities[i];
			if (entity === sender) continue;
			if (entity.onMessage) entity.onMessage.call(entity, sender, message);
		}
	} else if (entities instanceof Array) {
		for (var i = 0; i < entities.length; i++) {
			var entity = entities[i];
			if (entity === sender) continue;
			if (entity.onMessage) entity.onMessage.call(entity, sender, message);
		}
	} else {
		if (entities.onMessage) {
			entities .onMessage.call(entities, sender, message);
		}
	}
};

Sim.prototype.addEntity = function (proto) {
	// Verify that prototype has start function
	if (!proto.start) {  // ARG CHECK
		throw new Error("Entity prototype must have start() function defined"); // ARG CHECK
	}  // ARG CHECK
	
	if (!proto.time) {
		proto.time = function () {
			return this.sim.time();
		};
		
		proto.setTimer = function (duration) {
			var ro = new Sim.Request(
					this, 
					this.sim.time(), 
					this.sim.time() + duration);
			
			this.sim.queue.enqueue(ro.deliverAt, ro);
			return ro;
		};
		
		proto.waitEvent = function (event) {
			var ro = new Sim.Request(this, this.sim.time(), 0);
			
			ro.source = event;
			event.addWaitList(ro);
			return ro;
		};
		
		proto.queueEvent = function (event) {
			var ro = new Sim.Request(this, this.sim.time(), 0);
			
			ro.source = event;
			event.addQueue(ro);
			return ro;
		};
		
		proto.useFacility = function (facility, duration) {
			var ro = new Sim.Request(this, this.sim.time(), 0);
			ro.source = facility;
			facility.use(duration, ro);
			return ro;
		};
		
		proto.putBuffer = function (buffer, amount) {
			var ro = new Sim.Request(this, this.sim.time(), 0);
			ro.source = buffer;
			buffer.put(amount, ro);
			return ro;
		};
		
		proto.getBuffer = function (buffer, amount) {
			var ro = new Sim.Request(this, this.sim.time(), 0);
			ro.source = buffer;
			buffer.get(amount, ro);
			return ro;
		};
		
		proto.send = function (message, delay, entities) {
			var ro = new Sim.Request(this.sim, this.time(), this.time() + delay);
			ro.source = this;
			ro.msg = message;
			ro.data = entities;
			ro.deliver = this.sim.sendMessage;
			
			this.sim.queue.enqueue(ro.deliverAt, ro);
		};
	}
	
	var obj = (function (p) {
		if (p == null) throw TypeError(); 
		if (Object.create)
			return Object.create(p); 
		var t = typeof p; 
		if (t !== "object" && t !== "function") throw TypeError();

		function f() {}; 
		f.prototype = p; 
		return new f();
	}(proto));
	
	obj.sim = this;
	obj.id = this.counter();
	
	this.entities.push(obj);
	
	return obj;
};


Sim.prototype.simulate = function (endTime, flags) {
	this.endTime = endTime;
	for (var i = 0; i < this.entities.length; i++) {
		this.entities[i].start();
	}
	
	this.runLoop();
};

Sim.prototype.runLoop = function () {
	while (true) {
		// Get the earliest event
		var ro = this.queue.dequeue();
		
		// If there are no more events, we are done with simulation here.
		if (ro == undefined) break;

		// Uh oh.. we are out of time now
		if (ro.deliverAt > this.endTime) break;
		
		// Advance simulation time
		this.simTime =  ro.deliverAt;
		
		// If this event is already cancelled, ignore
		if (ro.cancelled) continue;

		ro.deliver();
	}
	
	this.finalize();
};

Sim.prototype.finalize = function () {
	for(var i = 0; i < this.entities.length; i++) {
		if (this.entities[i].finalize) {
			this.entities[i].finalize();
		}
	}
};

Sim.prototype.setLogger = function (logger) {
	this.logger = logger;
};

Sim.prototype.log = function (message, entity) {
	if (!this.logger) return;
	this.logger(this.simTime.toFixed(6)
			+ (entity === undefined ? "" : entity.id)
			+ "   " 
			+ message 
			+ "\n");
};

/** Facility
 *
 * Scheduling disciplines: 
 * 	- FCFS
 *  - Infinite servers // subcase of FCFS: servers = Infinity. IMM
 *  - Last come, first served, preempt: IMM
 *  - Processor sharing: IMM
 *  - Round robin, with time slice: NOT IMM
 *  
 *  Priority Based:
 *   - Preempt, resume: NOT IMM
 *   - Preempt, restart: NOT IMM
 *   - Round robin with priority: NOT IMM
 */

Sim.Facility = function (name, discipline, servers) {
	this.free = servers ? servers : 1;
	this.servers = servers ? servers : 1;
	switch (discipline) {

	case Sim.Facility.LCFS:
		this.use = this.useLCFS;
		break;
	case Sim.Facility.FCFS:
	default:
		this.use = this.useFCFS;
		this.freeServers = new Array(this.servers);
		for (var i = 0; i < this.freeServers.length; i++) {
			this.freeServers[i] = true;
		}
	}
	this.queue = new Sim.Queue();
	this.stats = new Sim.Population();
	this.busyDuration = 0;
};

Sim.Facility.FCFS = 1;
Sim.Facility.LCFS = 2;
Sim.Facility.NumDisciplines = 3;

Sim.Facility.prototype.reset = function () {
	this.queue.reset();
	this.stats.reset();
	this.busyDuration = 0;
};

Sim.Facility.prototype.systemStats = function () {
	return this.stats;
};

Sim.Facility.prototype.queueStats = function () {
	return this.queue.stats;
};

Sim.Facility.prototype.usage = function () {
	return this.busyDuration;
};

Sim.Facility.prototype.finalize = function (timestamp) {
	this.stats.finalize(timestamp);
	this.queue.stats.finalize(timestamp);
};

Sim.Facility.prototype.useFCFSSchedule = function (timestamp) {
	while (this.free > 0 && !this.queue.empty()) {
		var ro = this.queue.shift(timestamp); // TODO
		if (ro.cancelled) {
			continue;
		}
		for (var i = 0; i < this.freeServers.length; i++) {
			if (this.freeServers[i]) {
				this.freeServers[i] = false;
				ro.msg = i;
				break;
			};
		}

		this.free --;
		this.busyDuration += ro.duration;

		ro.saved_deliver = ro.deliver;
		ro.deliver = this.useFCFSCallback;
		
		// cancel all other reneging requests
		ro.cancelRenegeClauses();

		ro.deliverAt = ro.entity.time() + ro.duration;
		ro.entity.sim.queue.enqueue(ro.deliverAt, ro);
	}
};

Sim.Facility.prototype.useFCFS = function (duration, ro) {
	ro.duration = duration;
	this.stats.enter(ro.entity.time());
	this.queue.push(ro, ro.entity.time());
	this.useFCFSSchedule(ro.entity.time());
};

Sim.Facility.prototype.useFCFSCallback = function () {
	var ro = this;
	var facility = ro.source;
	// We have one more free server
	facility.free ++;
	facility.freeServers[ro.msg] = true;

	facility.stats.leave(ro.scheduledAt, ro.deliverAt);
	
	// restore the deliver function, and deliver
	ro.deliver = ro.saved_deliver;
	delete ro.saved_deliver;
	ro.deliver();
	
	// if there is someone waiting, schedule it now
	facility.useFCFSSchedule(ro.entity.time());
};

Sim.Facility.prototype.useLCFS = function (duration, ro) {
	// if there was a running request..
	if (this.currentRO) {
		this.busyDuration += (this.currentRO.entity.time() - this.currentRO.lastIssued);
		// calcuate the remaining time
		this.currentRO.remaining = 
			(this.currentRO.deliverAt - this.currentRO.entity.time());
		// preempt it..
		this.queue.push(this.currentRO, ro.entity.time());
	}

	this.currentRO = ro;
	// If this is the first time..
	if (!ro.saved_deliver) {
		ro.cancelRenegeClauses();
		ro.remaining = duration;
		ro.saved_deliver = ro.deliver;
		ro.deliver = this.useLCFSCallback;
		
		this.stats.enter(ro.entity.time());
	}
	
	ro.lastIssued = ro.entity.time();
	
	// schedule this new event
	ro.deliverAt = ro.entity.time() + duration;
	ro.entity.sim.queue.enqueue(ro.deliverAt, ro);
};

Sim.Facility.prototype.useLCFSCallback = function () {
	var ro = this;
	var facility = ro.source;
	
	if (ro != facility.currentRO) return;
	facility.currentRO = null;
	
	// stats
	facility.busyDuration += (ro.entity.time() - ro.lastIssued);
	facility.stats.leave(ro.scheduledAt, ro.entity.time());
	
	// deliver this request
	ro.deliver = ro.saved_deliver;
	delete ro.saved_deliver;
	ro.deliver();
	
	// see if there are pending requests
	if (!facility.queue.empty()) {
		var obj = facility.queue.pop(ro.entity.time());
		facility.useLCFS(obj.remaining, obj);
	}
};

/** Buffer
 * 
 */
Sim.Buffer = function (name, capacity, initial) {
	this.name = name;
	this.capacity = capacity;
	this.available = (initial === undefined) ? 0 : initial;
	this.putQueue = new Sim.Queue();
	this.getQueue = new Sim.Queue();
};

Sim.Buffer.prototype.current = function () {
	return this.available;
};

Sim.Buffer.prototype.size = function () {
	return this.capacity;
};

Sim.Buffer.prototype.get = function (amount, ro) {
	if (this.getQueue.empty()
			&& amount <= this.available) {
		this.available -= amount;
		
		ro.deliverAt = ro.entity.time();
		ro.entity.sim.queue.enqueue(ro.deliverAt, ro);
		
		this.getQueue.passby(ro.deliverAt);
		
		this.progressPutQueue();
		
		return;
	}
	ro.amount = amount;
	this.getQueue.push(ro);
};

Sim.Buffer.prototype.put = function (amount, ro) {
	if (this.putQueue.empty()
			&& (amount + this.available) <= this.capacity) {
		this.available += amount;
		
		ro.deliverAt = ro.entity.time();
		ro.entity.sim.queue.enqueue(ro.deliverAt, ro);
		
		this.putQueue.passby(ro.deliverAt);
		
		this.progressGetQueue();
		
		return;
	}
	
	ro.amount = amount;
	this.putQueue.push(ro);
};

Sim.Buffer.prototype.progressGetQueue = function () {
	var obj;
	while (obj = this.getQueue.top()) {
		// if obj is cancelled.. remove it.
		if (obj.cancelled) {
			this.getQueue.shift(obj.entity.time());
			continue;
		} 
		
		// see if this request can be satisfied
		if (obj.amount <= this.available) {
			// remove it..
			this.getQueue.shift(obj.entity.time());
			this.available -= obj.amount;
			obj.deliverAt = obj.entity.time();
			obj.entity.sim.queue.enqueue(obj.deliverAt, obj);
		} else {
			// this request cannot be satisfied
			break;
		}
	}
};

Sim.Buffer.prototype.progressPutQueue = function () {
	var obj;
	while (obj = this.putQueue.top()) {
		// if obj is cancelled.. remove it.
		if (obj.cancelled) {
			this.putQueue.shift(obj.entity.time());
			continue;
		} 
		
		// see if this request can be satisfied
		if (obj.amount + this.available <= this.capacity) {
			// remove it..
			this.putQueue.shift(obj.entity.time());
			this.available += obj.amount;
			obj.deliverAt = obj.entity.time();
			obj.entity.sim.queue.enqueue(obj.deliverAt, obj);
		} else {
			// this request cannot be satisfied
			break;
		}
	}
};

Sim.Buffer.prototype.putStats = function () {
	return this.putQueue.stats;
};

Sim.Buffer.prototype.getStats = function () {
	return this.getQueue.stats;
};

/** Event
 * 
 */
Sim.Event = function (name) {
	this.name = name;
	this.waitList = [];
	this.queue = [];
	this.isFired = false;
};

Sim.Event.prototype.addWaitList = function(ro) {
	if (this.isFired) {
		ro.deliverAt = ro.entity.time();
		ro.entity.sim.queue.enqueue(ro.deliverAt, ro);
		return;
	}
	this.waitList.push(ro);
};

Sim.Event.prototype.addQueue = function(ro) {
	if (this.isFired) {
		ro.deliverAt = ro.entity.time();
		ro.entity.sim.queue.enqueue(ro.deliverAt, ro);
		return;
	}
	this.queue.push(ro);
};

Sim.Event.prototype.fire = function(keepFired) {
	if (keepFired) {
		this.isFired = true;
	}
	
	// Dispatch all waiting entities
	for (var i = 0; i < this.waitList.length; i ++) {
		this.waitList[i].deliver();
	}
	this.waitList = [];
	
	// Dispatch one queued entity
	var lucky = this.queue.shift();
	if (lucky) {
		lucky.deliver();
	}
};

Sim.Event.prototype.clear = function() {
	this.isFired = false;
};