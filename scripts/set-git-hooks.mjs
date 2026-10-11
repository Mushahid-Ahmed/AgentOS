#!/usr/bin/env node
// `prepare` runs on every install, including on a CI/build host where the
// checkout has no .git directory. Setting a hooks path there is meaningless and
// makes `pnpm install` fail the whole build, so the hook wiring is skipped
// unless we are actually inside a work tree.
import { execFileSync } from 'node:child_process'

const inside = () => {
	try {
		return (
			execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
				stdio: ['ignore', 'pipe', 'ignore']
			})
				.toString()
				.trim() === 'true'
		)
	} catch {
		return false
	}
}

if (!inside()) {
	console.log('prepare: not a git work tree, skipping core.hooksPath')
	process.exit(0)
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
