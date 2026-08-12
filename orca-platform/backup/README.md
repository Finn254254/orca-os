# @orca/backup

Backup management. Mounted into Orca API at `/api/v1/backups`.

## What's real vs. architecture-only

Per the build instructions' own distinction ("application **configuration**
backups" vs. "application data backup **architecture**"):

- **`cluster-config`** and **`app-config`** backups are real — they
  snapshot live data (Control's current cluster config; a deployment's
  manifest, via `DeployService.getDeployment`) to a timestamped JSON file
  under `backupDir`.
- **`app-data`** backups are architecture-only: submitting one creates a
  job that fails with a clear reason (no volume-snapshot/rsync mechanism
  exists yet), rather than pretending to back up data it can't reach.

## Schedules

`BackupSchedule` is interval-based (`intervalMs`), not full cron syntax —
an explicit MVP scope choice ("scheduled backup **architecture**", not a
cron engine). A background poller (`startBackupScheduler`) checks every
enabled schedule and runs any that are due.

## Restore

`recordRestore` only accepts a `backupJobId` whose job `state` is
`succeeded` — restore *metadata* tracking (who restored what, when), not
an automated restore executor.

Run tests: `npx vitest run --root backup` (from `orca-platform/`).
