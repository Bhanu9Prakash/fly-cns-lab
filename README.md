# Fly CNS Activity Lab

[Open the live lab](https://fly-cns-lab.bhanukonepalli.chatgpt.site) · [Introduction](https://fly-cns-lab.bhanukonepalli.chatgpt.site/start.html) · [User guide](https://fly-cns-lab.bhanukonepalli.chatgpt.site/guide.html) · [Articles](https://fly-cns-lab.bhanukonepalli.chatgpt.site/articles/index.html)

A simplified computational twin built from **real Janelia MaleCNS v1.0 directed synapse counts**. It models activity propagation, not a fly's mind or validated behavior.

Three working models are included:

| Model | Population units | Neurons represented | Directed population links |
|---|---:|---:|---:|
| Closed-loop arena | 526 | 9,615 | 14,713 |
| Circuit experiment | 414 | 9,175 | 10,783 |
| Full typed CNS in sparse Python | 25,850 | 162,517 | 6,742,293 |

The full model includes all named, Traced neurons found in the downloaded annotations. It is still a population model, not all 162,517 neurons simulated individually. Untyped and non-Traced neurons are not modeled. The subnetwork's links represent 2,758,076 synapses.

## Open the interactive workspace locally

Clone the repository and serve the static site:

```bash
git clone https://github.com/Bhanu9Prakash/fly-cns-lab.git
cd fly-cns-lab
python -m http.server 8000 --directory dist
```

Open `http://localhost:8000` in your browser. No package install, API key, or account is needed to run the prepared subnetwork. Serve the files over HTTP; opening index.html with a file:// URL will block data and worker loading. External fonts are optional; system fonts are used when they cannot load.

The default **Fly in an arena** view couples an expanded circuit to geometric visual feedback and an illustrative body. Press **Start experiment**, then try **Silence DLM / DVM**, **Visual input on/off**, or **Motor output connected**. Pause, step, change camera views, and export a complete run. Read [the embodiment equations and research](dist/EMBODIMENT.md) for the exact assumptions. The source Flybody anatomy is used only for display; its MuJoCo dynamics and learned controllers are not running.

For the original **Circuit experiment** tab, try:

1. Leave **Looming object**, **Both sides**, input **1.0**, gain **3.0**, signed activity, glutamate inhibitory.
2. Press **Run stimulus**, then pause or scrub the timeline.
3. Select **DNp01** or **TTMn** to inspect a population and its actual outgoing synapse counts.
4. Press **Silence DNp01 on both sides**. Solid motor traces now show the lesion; dashed curves retain the intact reference.
5. Try the motion presets, a unilateral input, no stimulus, and alternative glutamate assumptions.
6. Export the experiment or per-population CSV. The experiment JSON contains settings, population identities, source provenance and complete subnetwork trajectories. The graph itself is a separate download.

## Introduction, guide and articles

The lab links to static reading pages that work without running the simulator:

- `dist/start.html`: introduction, scope, and basic terminology.
- `dist/guide.html`: first-flight tour, controls, experiments, exports, and troubleshooting.
- `dist/articles/index.html`: a four-article reading path.
- Articles cover the experiment, data preparation and rate equation, embodiment implementation, and interpretation of results.

The authored HTML fragments live in `content/`. Rebuild reading pages after changing those fragments or prepared model data:

```bash
python python/build_reading_pages.py
```

The generator inserts counts and reference results from the same JSON files used by the lab. Links can open `?view=world`, `?view=experiment`, or `?view=method`; arena examples additionally accept validated `scenario`, `intervention`, `vision=on/off`, and `motor=on/off` settings. These links select controls without starting playback.

A small runnable arena example accompanies the technical article:

```bash
node examples/run-arena.mjs
node examples/run-arena.mjs power
```

## Run the prepared model in Python

This scalar implementation uses only Python's standard library:

```bash
python python/simulate.py --graph dist/graph.json --output looming.json
python python/simulate.py --graph dist/graph.json --silence-type DNp01 --output looming-gf-silenced.json
python python/simulate.py --preset motion_a --side L --output left-motion.json
```

Each command writes trajectory JSON and population-summary CSV. Normalized activity is not Hz, muscle force, a behavioral probability, or a calibrated health index.

## Rebuild the data and run the full typed CNS

Use Python 3.10 or later and a virtual environment. The source downloads need about 1.1 GB of disk. Allow several GB of RAM for aggregation, roughly 45 MB for cached aggregate tables, and about 43 MB for a compressed full trajectory. The 600-model-ms default full simulation took about 3 seconds here after loading the prepared graph; performance depends on hardware.

```bash
python -m venv .venv
# macOS/Linux:
source .venv/bin/activate
# Windows PowerShell instead:
# .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python python/prepare_graph.py --cache data-cache --output dist/graph.json
python python/simulate_full.py --cache data-cache --output full-cns.npz
python python/simulate_full.py --cache data-cache --silence-type DNp01 --output full-cns-gf-silenced.npz
```

No neuPrint token is required: the importer uses official public Feather downloads. The generated cache includes `units.json` and `type-edges.feather`; the full solver uses these, not the cropped `dist/graph.json`. Use `--preset motion_a`, `--preset motion_b`, `--side L`, `--glutamate excitatory`, `--glutamate omit`, or `--mode unsigned` for further experiments.

The full simulation's NPZ contains `times`, `activity` (time × population), `peaks`, and `keys`. Its companion JSON records parameters and top motor populations. Load trajectories with:

```python
import numpy as np
r = np.load('full-cns.npz')
i = np.flatnonzero(r['keys'] == 'TTMn|R|T2')[0]
time_ms = r['times']
ttmn_activity = r['activity'][:, i]
```

Regenerating uses current bytes at the v1.0 URLs. Compare SHA-256 hashes in the new `dist/graph.json` with this repository's recorded source hashes before treating runs as identical. The importer reuses cached files; use a fresh cache directory when intentionally checking for updates.

## Equations and evidence

See [RESEARCH.md](RESEARCH.md) for the feasibility research, equations, assumptions and observed results. The app's **Model & data** view presents the same core distinctions.

Prepared artifacts:

- `dist/graph.json`: real weighted subnetwork, complete included body IDs, full incoming denominators and source hashes.
- `dist/full-cns-results.csv`: every full-model population's intact and DNp01-silenced peak in the bilateral looming experiment.
- `dist/full-cns-validation.json`: full-model settings and comparison against the interactive subnetwork.
- `dist/validation.json`: structural and numerical validation results for the subnetwork.
- `dist/sim.mjs`: pure deterministic browser model; `sim.worker.mjs` runs it off the main UI thread.
- `python/prepare_graph.py`: source download, streaming aggregation, and documented subnetwork selection.
- `python/simulate.py`: matching scalar Python solver.
- `python/simulate_full.py`: scalable sparse full-CNS solver.

## Tests

```bash
node --test tests/*.test.mjs
node tests/validate_arena.mjs
python -m unittest discover -s tests -p 'test_sparse.py'
python python/simulate.py --output baseline.json
node tests/validate_real_graph.mjs baseline.json
```

Verified: directed causal timing, reversed-edge negative control, zero-input silence, inhibitory effects, lesion effects, deterministic bounded values, graph integrity, structural reachability and Python/JavaScript trajectory agreement. These are numerical/structural tests. No behavioral or electrophysiological validation has been done. Browser visual/end-to-end testing was not performed.

## Attribution

MaleCNS data: FlyEM at HHMI Janelia, Cambridge Drosophila Connectomics Group, MRC Laboratory of Molecular Biology and Google Research. Data is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Retain the dataset attribution and provenance when redistributing the graph. This is an independent prototype, without Janelia endorsement. Project code is MIT licensed; data retains CC BY 4.0. Modified Flybody geometry is Apache 2.0, with its license and notices under `dist/assets`. Vendored Three.js 0.180.0 is MIT licensed, with its license under `dist/vendor`. See `dist/EMBODIMENT.md` for asset sources and reproduction.
