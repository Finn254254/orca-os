# @orca/scheduler

Orca-specific job scheduler: `selectNode(nodes, spec)` filters nodes by
hard requirements (online status, pinned target node/group, required
capability tags, CPU cores, RAM headroom, GPU/VRAM) then scores survivors
by available headroom (free CPU%, free RAM%, a temperature penalty) and
picks the best — returning a human-readable reason either way (why a node
was picked, or why every node was rejected).

Deliberately not a Kubernetes-style scheduler — a small, explainable, pure
function. Consumed by `@orca/compute`.

Run tests: `npx vitest run --root scheduler` (from `orca-platform/`).
