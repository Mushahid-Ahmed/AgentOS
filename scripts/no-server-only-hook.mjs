// The unit-test lane runs modules from src/ with node's native type stripping, but
// `import 'server-only'` is a bundler-condition package that node cannot resolve. Map
// it to an empty module so server modules (rate limiting, audit) stay testable.
export async function resolve(specifier, context, nextResolve) {
	if (specifier === 'server-only') {
		return { url: 'data:text/javascript,export default undefined', shortCircuit: true }
	}
	return nextResolve(specifier, context)
}
