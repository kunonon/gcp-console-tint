// Exhaustiveness guard for switch/if chains over a union: reaching it with a value the type
// system did not narrow to `never` fails to compile, and a value outside the union at runtime
// (only reachable by casting or untyped input) fails loudly.
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
