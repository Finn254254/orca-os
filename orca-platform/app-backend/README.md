# @orca/app-backend

Backend support for future mobile/desktop Orca clients. This is *not* a
duplicate of Orca API's existing surface — auth, AI conversations, and
nodes/apps/models/jobs are already real, versioned REST resources at
`/api/v1/*` that a mobile/desktop client uses directly, same as the
Dashboard/CLI. This package exists only for the pieces that are genuinely
mobile-specific:

- **Server discovery** (`GET /api/v1/app/discover`, unauthenticated): lets
  a client verify it's actually talking to an Orca server — and see its
  cluster name — before it has a session token to log in with. Real
  network-level discovery (mDNS/Bonjour so a client doesn't need a
  manually-entered address at all) needs OS-level support and isn't built
  here; this is the "verify what you found" half, not the "find it"
  half — see `docs/OS_INTEGRATION.md`.
- **Cluster status rollup** (`GET /api/v1/app/summary`, authenticated): one
  compact request (node counts, average CPU/RAM) instead of fetching and
  aggregating `/nodes` client-side — worth it for a mobile client on a
  slower or metered connection.
- **Notifications** (`/api/v1/app/notifications`): a per-user inbox.
  Admin/operator can send a notification to one user or broadcast to
  everyone (e.g. "cluster restarting at 10pm"); any user can list and
  mark their own read.
- **Device registry** (`/api/v1/app/devices`): register a push token
  (platform + opaque token) per user. This is the registry a real push
  relay (APNs/FCM) would read from to actually deliver notifications —
  that delivery step is **not implemented**; registering a device today
  just makes it visible via the API. Tracked as a known limitation in
  `docs/PROGRESS.md`.

## Architecture

`AppBackendService` orchestrates two `JsonStore`-backed per-user stores
(`NotificationStore`, `DeviceStore`) plus two narrow structural ports —
`ClusterPort` (`getClusterConfig`/`listNodes`, satisfied directly by
`api/src/controlClient.ts`'s `ControlClient`) and `UserDirectory`
(`listUserIds`, satisfied by a one-line adapter over `@orca/security`'s
`UserStore`) — the same `ControlPort`-style pattern used by
`@orca/compute`/`@orca/deploy`/`@orca/update`, so this package never
depends on those packages' full surface.

`createAppBackendRouter` takes `requireAuth`/`writeGuard` middleware and
applies them per-route (not at the mount level) so `/discover` can stay
public while every other route under `/api/v1/app` requires a session.

## Tests

`appBackendService.test.ts`: discovery, summary aggregation (including
the "no metrics yet" and "some nodes missing metrics" cases), per-user
notification CRUD + broadcast, device registration ownership. Route
contract tests in `routes.test.ts` (fake auth middleware, in-package).
Full HTTP-level coverage — real auth, a real second user, a real
403-for-viewer-broadcast check — lives in `api/src/appBackend.test.ts`,
the same split used for Orca AI and Orca Studio.
