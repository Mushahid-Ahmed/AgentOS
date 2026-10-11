import type { OrchestrationEvent, RunStore } from './types'

// Event bus (§10.8). Every Orchestra state change flows through here exactly
// once, then fans out to (a) live subscribers — the SSE stream to the UI — and
// (b) the RunStore for replay persistence. Subscribers are called synchronously
// in registration order; a throwing subscriber is isolated so one bad listener
// (a dropped SSE connection, say) can't break the run or starve the store.
//
// Persistence is fire-and-forget with its own catch: a store write must never
// add latency to the run nor crash it. The store is the durability layer, not a
// gate — §10.1 requires persisting after state changes, and the executor also
// awaits store.save(run) at each transition for the run aggregate itself.

export type EventSubscriber = (event: OrchestrationEvent) => void

export class EventBus {
	private readonly subscribers = new Set<EventSubscriber>()
	private readonly store?: RunStore

	constructor(store?: RunStore) {
		this.store = store
	}

	subscribe(subscriber: EventSubscriber): () => void {
		this.subscribers.add(subscriber)
		return () => this.subscribers.delete(subscriber)
	}

	emit(event: OrchestrationEvent): void {
		for (const subscriber of this.subscribers) {
			try {
				subscriber(event)
			} catch {
				// A live listener failing (client gone) must not derail the run.
			}
		}
		if (this.store) {
			// Persist for replay; never block or throw into the run.
			void this.store.appendEvent(event.runId, event).catch(() => {})
		}
	}
}
