# Sync between phones by QR code only

Devices sync only by showing and scanning animated QR codes, face to face. This was Alex's explicit choice.
- Bluetooth is impossible for a PWA: Web Bluetooth can only connect to devices, not advertise as one, and iOS Safari doesn't support it.
- WebRTC depends on the local network, whose mDNS and hotspot behaviour varies by device.
- QR works offline on every phone with a camera.

The typical sync is between relatives in one lineage, about 400 people (about 20 KB). A speed test on real phones gates the build: one lineage in at most 30 seconds per direction. A whole family tree (3,420 people) syncs too, more slowly (measured about 2–3 minutes on 2026-11-06), with a time estimate shown first. If the gate misses, building stops and Alex decides. An encrypted sync file sent by AirDrop or Nearby Share is the obvious candidate, but it is not pre-approved.

A self-hosted server that syncs over HTTPS may come later as one more device. GEDCOM and backup files are not sync.
