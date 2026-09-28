# Playback fixture

`workout.mp4` is a generated 12-second solid-color H.264 video used only by browser tests. It contains no production workout content.

Regenerate with:

```sh
ffmpeg -f lavfi -i color=c=0x0a2a70:s=160x90:r=10 -t 12 -c:v libx264 -pix_fmt yuv420p -movflags +faststart tests/fixtures/workout.mp4
```

The workout E2E suite uses the actual backend for authentication, measurement, assignment and event persistence. Media delivery alone is intercepted, allowing deterministic seek and end-of-video checks independently of the source server.
