# Spike results (task 0.10)

2026-11-06. Alex's Android phone (Chrome, installed to the Home Screen) and his Mac (Chrome), at https://steblo-app.vercel.app/spike/. No iPhone was available, so every iOS item below is open.

## Gate: passed, provisionally

Gate (reference R17 item 2, revised 2026-11-06): one lineage, about 400 people or 20 KB, crosses in at most 30 seconds per direction. All six runs used **40 KB**, twice the gate size:

| Direction | Runs (40 KB each) | Speed |
|---|---|---|
| Android scans, Mac shows | 17 s, 21 s, 21 s | about 1.9–2.4 KB/s |
| Mac scans, Android shows | 10 s, 10 s, 13 s | about 3–4 KB/s |

So a 20 KB lineage takes about 5–11 seconds. One 200 KB run (about the size of a whole 3,420-person tree) took 63 s at 3.16 KB/s. Times depend noticeably on how steadily the phone is held. The gate stays provisional until one iPhone run each way passes, before release.

Source: times and speeds as Alex reported them from the status line, plus the logs he pasted for the earlier runs. The final runs' log files weren't attached.

## Pinned settings (Spike v9)

| Setting | Value | Why |
|---|---|---|
| Coding | LT, size-class robust-soliton tables; plain blocks first below 100 blocks | Simulation and module tests: 1.24 frames read per block at 342 blocks against 2.5–3.9 for cyclic repeat at the measured loss |
| Block size S | 600 bytes | 800 failed to read; 300 caps throughput near 1.3 KB/s |
| QR mode | byte | base45 makes about 15% denser codes and was only needed for the native reader |
| Error correction | L | M makes denser codes; L read reliably |
| Display rate | 8 frames per second | 12 gave no gain |
| Decoder | jsQR in 2 Web Workers | 1 worker: 13 s against 9 s for 20 KB; Android's native BarcodeDetector read more often but recovered fewer blocks overall, and iPhone Safari lacks it |
| Camera picture | centre 80% square, shrunk to 640 px | the full 1280 px picture read only 6–17% of frames at 145 ms each |

## How the settings were found

| Step | Setting | Result |
|---|---|---|
| First runs | full camera picture, hand-made LT table | 5 of 80 reads succeeded, 145 ms each; far too slow |
| Crop and shrink the camera picture | block 300, 8 fps | 0.48 KB/s; block 300 too small |
| | block 600 | 2.06 KB/s (50 KB) |
| | block 800 | failed to read |
| 200 KB, three runs | block 600, 1 worker, old table | 147 s, 200 s, 193 s; about 40% of frames caught, 1.3–1.9 frames needed per block |
| Size-class LT tables, 2 workers | 20 KB | 9 s (2.12 KB/s); with 1 worker 13 s |
| | 200 KB | 63 s (3.16 KB/s) |

## Other R17 items

| # | Item | Result |
|---|---|---|
| 1 | Camera in the installed app | Works on Android. First-read time not recorded for the final runs. iOS open |
| 3 | WebCrypto | ok on the Mac (Chrome); Android not recorded. iOS open |
| 4 | CompressionStream `deflate-raw` | ok on the Mac (Chrome). iOS open |
| 5 | Wake Lock in the installed app | Not recorded on Android. iOS open |
| 6 | Save and open a file | Not recorded. iOS open |
| 7 | `navigator.storage.persist()` | Not recorded on Android. iOS open |
| 8 | Storage isolation, browser against installed app | Not recorded. iOS open |
| 9 | Redraw speed | Runs at milestone 5 |
| 10 | Decoder on the main thread against Workers | Workers win (2 workers: 9 s against 1 worker: 13 s) |
| — | Install | Android Chrome needed a service worker with a fetch handler and a fresh load after clearing the site's data; then it installed |

## Still owed before release

- One iPhone: install from Safari, Device checks, Wake Lock for 3 minutes, file save and open, and one 20 KB run each way.
- Android Device checks in the installed app, with the log saved: items 3–8.
