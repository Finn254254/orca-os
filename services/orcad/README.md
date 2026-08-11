# orcad

`orcad` is the planned Orca OS core system daemon.

Initial responsibilities:

- expose basic node status
- provide node identity
- collect hardware and health information
- provide a local API for the Orca CLI

The first implementation should remain small and testable. Cluster discovery, model management, and remote administration will be added after the local control path works reliably.
