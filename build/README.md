# Image Build

This directory will contain the reproducible Orca OS image build.

The first target is x86-64 for virtual-machine testing on a Windows development PC.

The build must eventually produce a bootable disk image and install the common Orca packages and system services automatically. ARM64 hardware targets will reuse the common userspace while supplying target-specific boot and kernel configuration.
