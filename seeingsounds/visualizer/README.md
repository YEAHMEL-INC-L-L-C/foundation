# ZEAL cover visualizer

`zeal_cover_visualizer.py` animates the layered ZEAL cover collage in time with a track and writes an MP4 with the track's audio.

## How it decides what moves

All motion comes from audio math. No AI generation is used, and the same inputs always give the same video.

| Signal measured from the audio | What it drives |
| --- | --- |
| Bass energy (30 to 150 Hz) and its rising edges (kicks) | Crown hop and squash, globe, hands, whole-cover nod and zoom |
| Vocal-range energy (300 to 3000 Hz) | Mouth opening |
| High-frequency energy (5 to 12 kHz) | Flame flicker, cross pulse |
| Spectral flux (sudden changes, such as snares) | Bullet jolt, cross snap, faint flash |
| Overall energy | Sway of the flowers, mushrooms, cards, clouds, roses, and waves |

Kick and snare impulses feed damped springs, which give the bounce and settle.

## What you need

- Python 3
- ffmpeg on your PATH
- The Python packages in `visualizer/requirements.txt`
- The artwork and audio, which are not in this repository

Install the packages:

```
pip install -r visualizer/requirements.txt
```

## Artwork layout

Put the artwork in `assets/zeal/`. That folder is ignored by git, so it stays on your machine.

```
assets/zeal/cover.png        finished square cover
assets/zeal/layers/*.png     full-canvas transparent layers (2100 x 2100 px canvas)
```

Layers the script reads: `CROWN`, `TOUNGE`, `WORLD_ON_FIRE`, `CROSS`, `BULLETS`, `HANDS`, `FLOWERS`, `MUSHROOMS`, `CARDS`, `CARDS_2`, `CLOUDS`, `ROSES`, `ROSES_2`, `WATER_WAVE`, `BLUE_WAVE`.

Use `--cover`, `--layers`, and `--canvas` if your files live elsewhere or use a different canvas size.

## Usage

```
python visualizer/zeal_cover_visualizer.py AUDIO START_SECONDS DURATION_SECONDS OUTPUT.mp4 [options]
```

Examples:

```
# 30-second YouTube-format clip starting at 0:30
python visualizer/zeal_cover_visualizer.py track.wav 30 30 clip_16x9.mp4 --fmt 16x9 --num 01 --title "Each One"

# Vertical clip for Shorts and Reels, with a featured artist line
python visualizer/zeal_cover_visualizer.py track.wav 30 20 clip_9x16.mp4 --fmt 9x16 --num 04 --title "GDB" --feat "feat. Hoodie BK"
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--fmt` | `16x9` (1920x1080), `9x16` (1080x1920), or `1x1` (1080x1080) | `16x9` |
| `--title` | Track title. Leave it off for no text. | none |
| `--num` | Track number shown above the title | none |
| `--feat` | Featured-artist line under the title | none |
| `--artist` | Artist name | `YEAHMEL` |
| `--tag` | Small line under the artist name | `ZEAL` |
| `--bounce` | Motion strength. 1.0 is standard, higher is bouncier. | `1.0` |
| `--fps` | Frames per second | `30` |
| `--font` | Path to a bold `.ttf` font for the text | first common system font found |

## Notes

- The audio is lowered by 2.5 dB and limited, so loud masters do not clip after AAC encoding.
- The clip fades in over 0.3 seconds and out over the last second.
- Rendering is slow. On a 2-core Linux machine, one second of 16:9 video took several seconds to render.
- The script was written and run on Linux. It has not been run on macOS or Windows yet.
