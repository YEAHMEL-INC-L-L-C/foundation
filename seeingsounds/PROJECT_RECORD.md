# Seeing Sounds — Project Record
**Founder:** Melvin Gregory King (YeahMel) | **Last Updated:** Nov 23, 2026

## Product Vision
An interactive, ethical music-to-visual analysis and design studio ("CapCut-style control tuned for musicians, driven by verified music math"). Helps independent artists inspect the mathematical and cognitive structure of their tracks and map sound to customizable visual elements (color, motion, typography) while keeping 100% of audio creation, editing, and visual judgment in human hands.

## Confirmed Requirements
- Zero AI audio generation, voice alteration, or audio editing (belongs strictly to DAWs).
- Zero AI image generation; visuals are driven by deterministic audio math + human-editable rules.
- Mathematical accuracy first: all beat grids, durations, and energy/pitch numbers must add up.
- Cognitive & music-theoretic grounding (GTTM phrasing, Implication-Realization tension/release, semiotic segmentation, modular pitch math).
- Gemini API (`gemini-3.8-flash` via `google-genai` SDK) acts as core reasoning/structuring engine, isolated behind `ai_provider.py`.
- Target V1 environment: Local web app running on 2017 Intel MacBook Pro; $300 Google Cloud Credits; beginner-friendly, step-by-step workflow.

## Architecture Decisions
- **Frontend:** React + TypeScript + Tailwind CSS (Vite), Web Audio API for decoding and playback, SVG for charts. Lives in `src/`.
- **Backend:** Node + Express (`server.ts`) running the TypeScript port of the math engine (`src/engine/`). Deterministic, CPU only, no cloud cost.
- **Python tools:** `math_engine.py` (reference engine, same math as the TypeScript port) and the offline ZEAL cover visualizer (`visualizer/`).
- **AI Layer:** Planned, not yet wired in. `google-genai` SDK calling `gemini-3.8-flash` with JSON Schema Structured Outputs.
- **Storage:** Local JSON files (`./projects/`) + `.env` for `GEMINI_API_KEY`.

## Completed Milestones
- [x] Discovery & product definition locked (Option B: Interactive Music-Math & Cognitive Visualizer Studio).
- [x] V1 technical stack, cost guardrails, and privacy architecture established.
- [x] Deterministic audio math engine (Python + TypeScript).
- [x] Offline ZEAL cover visualizer.
- [x] Local web app: upload a track (or use the built-in sample) and see tempo, onsets, pitch, chroma, energy/brightness timeline, sections, and the integrity check.

- [x] Deeper analysis: key estimate, beat grid, 4-bar phrases with build/release shapes, tension curve, and per-section detail, shown in the web app.

## Next Concrete Task
- **Milestone 3:** Song meaning feedback (themes, story, mood, lyrics) through the AI layer.
