package main

import (
	"math"
	"testing"
)

func TestParseRemoteHostMetrics(t *testing.T) {
	output := `__VESSEL_CPU_FIRST__
cpu 100 0 50 850 0 0 0 0
__VESSEL_CPU_SECOND__
cpu 140 0 70 890 0 0 0 0
__VESSEL_MEMORY__
MemTotal:        1000 kB
MemAvailable:     250 kB
__VESSEL_DISK__
Filesystem 1K-blocks Used Available Use% Mounted on
/dev/sda1        1000 400 600 40% /
`
	metrics, err := parseRemoteHostMetrics(output)
	if err != nil {
		t.Fatalf("parseRemoteHostMetrics() error = %v", err)
	}
	if math.Abs(metrics.CPU.Percent-60) > 0.001 {
		t.Errorf("CPU percent = %v, want 60", metrics.CPU.Percent)
	}
	if metrics.Memory.Total != 1_024_000 || metrics.Memory.Used != 768_000 {
		t.Errorf("memory = %+v, want used 768000 and total 1024000", metrics.Memory)
	}
	if metrics.Disk.Total != 1_024_000 || metrics.Disk.Used != 409_600 || metrics.Disk.Source != "/" {
		t.Errorf("disk = %+v, want root disk usage 409600/1024000", metrics.Disk)
	}
}

func TestParseRemoteHostMetricsRejectsIncompleteOutput(t *testing.T) {
	if _, err := parseRemoteHostMetrics(""); err == nil {
		t.Fatal("parseRemoteHostMetrics() accepted incomplete output")
	}
}
