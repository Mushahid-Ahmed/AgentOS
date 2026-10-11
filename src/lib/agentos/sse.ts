// Pure SSE frame parsing for the AgentOS run stream (M7). Split out of the client
// hook so the protocol logic is unit-testable at $0 and shared by anything that
// reads the run stream. No React, no fetch.
//
// The server (src/server/agentos/run.ts) writes each frame as
// `event: <name>\ndata: <json>\n\n`. The event NAME drives the run-view reducer —
// the `run` init and `decision` payloads carry no `type` field — so the name is read
// from the `event:` line, falling back to `data.type` for the self-describing
// orchestration events. A frame with no parsable data yields null (ignored), never a
// throw: the wire is a boundary.

export type RunFrame = { name: string; data: unknown }

export function parseRunFrame(frame: string): RunFrame | null {
	let name: string | null = null
	const dataLines: string[] = []
	for (const line of frame.split('\n')) {
		if (line.startsWith('event:')) {
			name = line.slice(6).trim()
		} else if (line.startsWith('data:')) {
			dataLines.push(line.slice(5).trim())
		}
	}
	if (dataLines.length === 0) return null

	let data: unknown
	try {
		data = JSON.parse(dataLines.join('\n'))
	} catch {
		return null
	}

	if (!name && typeof data === 'object' && data !== null && 'type' in data) {
		const t = (data as { type: unknown }).type
		if (typeof t === 'string') name = t
	}
	if (!name) return null
	return { name, data }
}

// Split a raw SSE chunk buffer into complete frames plus the incomplete remainder.
// Frames are delimited by a blank line (`\n\n`); the caller appends the remainder to
// the next chunk so a frame split across reads is never dropped.
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
	const frames: string[] = []
	let rest = buffer
	let separator: number
	while ((separator = rest.indexOf('\n\n')) !== -1) {
		frames.push(rest.slice(0, separator))
		rest = rest.slice(separator + 2)
	}
	return { frames, rest }
}
