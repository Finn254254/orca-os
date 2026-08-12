# Allwinner V3s board contract

This document records the hardware information Orca OS will need from the first custom V3s board. It is a design-time contract, not a finished board image: exact GPIOs, regulators, clocks, PHY details, and storage geometry must come from the manufactured board schematic and device tree.

## Boot and recovery

- Expose a reliable 3.3 V UART console with labelled TX, RX, and GND test points.
- Keep the USB OTG data pair available for Allwinner FEL recovery and initial provisioning.
- Define the primary boot medium: microSD, eMMC, SPI NOR, or a documented priority combination.
- If eMMC is fitted, document its bus width, voltage, reset connection, and boot-partition strategy.
- If SPI NOR is fitted, document capacity and whether it stores only SPL/U-Boot or recovery assets too.
- Provide an accessible reset control and a documented way to force FEL/recovery mode.

## Memory and storage

- Record the exact DRAM part, width, density, routing assumptions, and validated U-Boot DRAM parameters.
- Record usable RAM after reserved-memory regions. V3s designs are constrained, so this determines whether the Debian/Python development stack is viable or a smaller production userspace is required.
- Size persistent storage for two system slots if atomic A/B updates are planned, plus writable state and logs.
- Decide which data must survive factory reset: node identity, enrollment credentials, configuration, and diagnostic history.

## Networking

- Record the Ethernet PHY model, interface mode, PHY address, reference clock direction/frequency, reset GPIO polarity/timing, and interrupt GPIO.
- Store a unique MAC address in a documented non-volatile location or manufacturing data partition.
- Identify any USB or Wi-Fi networking hardware and required firmware blobs.
- Do not depend on a Linux interface name such as `eth0`; Orca discovers interfaces through sysfs and the device tree.

## Power, thermal, and reliability

- Describe every regulator, voltage rail, enable GPIO, ramp delay, and power-good signal used by the SoC and peripherals.
- Expose the hardware watchdog and document its clock/reset behavior.
- State whether an RTC and backup supply exist; otherwise Orca must treat wall-clock time as untrusted until synchronized.
- Identify available temperature sensors and realistic warning/shutdown thresholds for the enclosure.
- Document brownout behavior and how storage corruption is prevented during power loss.

## Device-tree identity

The final board device tree must provide:

- a unique root `compatible` string, with a vendor prefix reserved for Orca hardware;
- a human-readable root `model`;
- aliases for the production serial console and primary Ethernet controller;
- correct `status`, pinctrl, clocks, resets, regulators, PHY, LEDs, keys, storage, USB, and watchdog nodes;
- a stable source for board serial number and MAC address where the hardware supports one.

`orca platform` and `GET /v1/platform` consume these standard Linux device-tree and sysfs interfaces. No board-specific path should be added to the Orca services when a standard kernel interface can represent the same fact.

## First-board bring-up order

1. Verify rails, reset, oscillator, and DRAM without storage writes.
2. Enter FEL over USB and load SPL/U-Boot into RAM.
3. Establish the UART console and validate DRAM size.
4. Boot a mainline kernel with the board DTB and an initramfs.
5. Validate SD/eMMC, Ethernet PHY, USB, watchdog, thermal reporting, and clean shutdown.
6. Build the first Orca ARM image only after the device tree describes those components correctly.
7. Run the architecture-neutral Orca CLI/API tests, then add destructive storage/update tests on sacrificial media.

## Production software gates

The current x86 image is a development reference and must not be flashed to the V3s board. Before producing a board image:

- build a separate 32-bit ARM target around SPL/U-Boot, the board DTB, and a measured kernel configuration;
- measure usable DRAM after reservations and define hard boot/runtime memory budgets from the real PCB;
- remove UEFI, QEMU guest tooling, serial root autologin, the development root SSH key, and unneeded packages;
- decide whether Python fits the steady-state budget; otherwise replace the agent/API with a small native daemon;
- keep logs volatile and bounded unless a deliberate wear-managed persistent log partition is designed;
- require TLS or an authenticated encrypted overlay before exposing the bearer-authenticated API on a physical LAN;
- boot to local core readiness without a cable and bound DHCP/network-online waits;
- provision unique node identity, API credentials, SSH host keys, and the factory MAC per device;
- validate watchdog, brownout recovery, thermal policy, storage corruption behavior, and recovery boot before field use.

The x86 constrained-memory smoke test is a regression signal only. Its current measured Windows/WHPX baseline is 1536 MiB/two vCPUs; 1024 MiB and lower fail in the generic Debian initrd before Orca starts. Neither result certifies the V3s bootloader, ARM kernel, 32-bit working set, or actual board DRAM margin.

## Information to capture from the PCB design

Before implementing `targets/allwinner-v3s/`, export or record:

- schematic PDF and revision;
- PCB revision and assembly variants;
- BOM part numbers for DRAM, PHY, storage, PMIC/regulators, oscillator, and EEPROM;
- GPIO/pin multiplexing table;
- power-tree diagram;
- boot strap and recovery behavior;
- connector and test-point pinout;
- expected device-tree compatible string and board model.
