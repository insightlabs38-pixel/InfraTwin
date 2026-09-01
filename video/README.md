# InfraTwin final submission video tooling

This directory is isolated video-editing tooling for the OpenAI WebMCP Challenge submission. It does not modify InfraTwin runtime or engineering semantics.

## Render

Place the validated source clips in `video/public/footage/`:

- `01-opening-workspace.mp4`
- `02-human-agent-plan.mp4`
- `03-failure-evidence.mp4`
- `04-lock-and-replan.mp4`
- `05-compare-and-verify.mp4`
- `06-scale-proof.mp4`
- `07-webmcp-proof.mp4`

Install the tooling dependency and render:

```bash
python -m pip install -r video/requirements.txt
python video/render.py
video/scripts/validate-video.sh video/output/InfraTwin-final-demo.mp4
```

The renderer creates the title/problem cards, both reusable diagrams, restrained product callouts, source-footage crops, the final no-audio picture master, and a narration-ready MP4 with a silent AAC timing track.

## Narration

A synthetic voice is intentionally **not** generated. Record `video/narration.md` naturally at roughly 125–135 WPM, starting at 00:03.000, then mux it without re-encoding video:

```bash
video/scripts/mux-narration.sh /path/to/narration.wav
```

Preferred narration source: WAV, 48 kHz, clean/dry speech, no room echo, no music. The final mux uses AAC 192 kb/s.

## Outputs

- `video/output/InfraTwin-final-demo.mp4` — 155.5 s narration-ready master, H.264 + silent AAC timing track until real narration is muxed
- `video/output/InfraTwin-final-demo-no-audio.mp4` — picture master
- `video/output/InfraTwin-final-demo.srt` — exact narration captions
- `video/exports/shared-workspace-diagram.png`
- `video/exports/replan-loop-diagram.png`
- `video/output/review-frames/` — representative frame-review images
- `video/output/validation.json`

## Claim discipline

The edit never claims that the LLM performs routing, optimization, N-1 analysis, or verification. Those conclusions come from InfraTwin's deterministic computation. The WebMCP claim is specifically that the agent operates against the same live browser Network + ChangePlan rather than a separate backend state.
