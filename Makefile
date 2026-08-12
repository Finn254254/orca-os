SHELL := /usr/bin/env bash

.PHONY: test image vm vm-smoke

test:
	./tests/run.sh

image:
	./build/build-image.sh

vm:
	./vm/run-qemu.sh

vm-smoke:
	./vm/smoke-test.sh
