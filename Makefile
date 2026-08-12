SHELL := /usr/bin/env bash

.PHONY: test image vm vm-reset vm-ssh vm-smoke vm-smoke-lowmem vm-smoke-cluster resource-report artifact-budget

test:
	./tests/run.sh

image:
	./build/build-image.sh

vm:
	./vm/run-vm.sh

vm-reset:
	./vm/reset-vm.sh

vm-ssh:
	./vm/connect-ssh.sh

vm-smoke:
	./vm/smoke-test.sh

vm-smoke-lowmem:
	./vm/smoke-test-lowmem-windows.sh

vm-smoke-cluster:
	./vm/smoke-test-cluster-windows.sh

resource-report:
	./tools/resource-report.sh --image ./out/orca-os-x86_64.raw

artifact-budget:
	./build/check-size-budget.sh ./out/orca-os-x86_64.raw ./out/orca-os-x86_64.initrd ./out/orca-os-x86_64.efi ./out/orca-os-x86_64.size-report.json
