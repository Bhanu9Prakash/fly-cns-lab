# Fly in an arena: research, model and reproduction

Implemented 6 September 2026. This is a connectome-driven demonstration of embodiment with explicit, unfitted sensory and body rules. It is not a validated fly flight controller.

## Research choices

Flybody provides anatomical geometry and a MuJoCo body suitable for flight and walking research. The published project achieves locomotion with trained controllers. Here we reuse its anatomical appearance only; the MuJoCo dynamics, aerodynamic model and learned policies are **not running**. The mesh is an independent anatomical asset, not a reconstruction of the MaleCNS specimen. [Flybody source and documentation](https://github.com/TuragaLab/flybody), [Vaxenburg et al., Nature, 2025](https://www.nature.com/articles/s41586-025-09029-4).

The motor distinction matters: DLM/DVM supply wing power, hDVM supplies haltere power, and TTMn drives a jump muscle. The b2 muscle is among the wing steering muscles. These identities motivate the chosen readouts; they do not specify our rate-to-force coefficients or yaw sign. The giant fiber circuit also uses electrical synapses, absent here. [Cheong et al., eLife, motor and takeoff circuitry](https://elifesciences.org/articles/96084).

[NeuroMechFly / FlyGym](https://neuromechfly.org/) is another platform for coupling a fly body to sensory feedback. A stronger next implementation would connect the exported neural state to a calibrated MuJoCo/Flybody controller, with a retina, muscle dynamics and independent behavioral validation. This lightweight arena establishes the software feedback interface first.

## Measured graph

The arena has **526 populations, 9,615 represented neurons, 14,713 directed edges and 2,928,216 synapses**, from the same official MaleCNS v1.0 files as the reference experiment.

`python/prepare_arena_graph.py` starts with all 414 original populations. It adds the bilateral DLMn a,b; DLMn c-f; DVMn 1a-c; DVMn 2a,b; DVMn 3a,b; and b2 MN populations, the 12 strongest presynaptic populations of each added motor unit, strong directed paths from the original visual seeds, and existing bilateral counterparts. All induced edges are retained. Paths minimize summed `−log(input fraction) + 0.3`; this is an anatomical selection rule, not a measured physiological path preference.

No new synapse is invented. Every normalization denominator is the target's total original incoming synapse count, before cropping or silencing. Unrepresented inputs remain silent. All 526 units have complete within-unit transmitter agreement. Cropping still omits recurrent influences; this graph is not quantitatively interchangeable with the full CNS.

## State and timing

Coordinate axes: x is the initial forward direction, y initial left, z up. Geometry is scaled so the published 0.297 cm body length corresponds to one display unit. Motion uses **arbitrary arena units (au)**; acceleration and timing are not calibrated to that physical length. Initial position is (0,0,0.45), with zero velocity, heading and activity. The floor under the fly's body center is z=0.45.

One world step is 0.02 model seconds. It contains ten neural updates of 2 model ms each. Playback speed changes how quickly steps are displayed, without changing the model. Each step:

1. Compute target position and geometric features using the current fly pose and velocity.
2. Hold those features fixed for ten synchronous signed neural updates.
3. Compute motor readouts from the resulting rates.
4. Apply the body adapter and contact constraints.
5. Record the updated pose and rates; use the new pose for the next sensory step.

The existing leaky-rate equation is unchanged: `r += (1-exp(-2/20)) * (max(0,tanh(input + 3 W r)) - r)`. ACh outputs are positive, GABA/histamine negative, glutamate negative, and unknown/modulatory effects omitted. All populations are updated from the same prior state. Silence clamps selected populations to zero without renormalizing edges.

## Visual input

The target is a sphere of radius 1.25 at `(12 − 2.4t, lateral_offset, 1.1)`, moving along x at −2.4 au/s. The offset is 0, +2, or −2 for frontal, left, or right approach. A stationary control holds it at x=6. The target is visual only and exerts no collision force.

Let d be distance to its center, R its radius, b its bearing relative to the fly heading, and v_radial the relative target velocity projected along that displacement:

```
angular_size = 2 atan2(R, d)
expansion = max(0, −2 R v_radial / (d² + R²))
strength = clip(8 expansion, 0, 1.5) * max(0, cos(b))
left = strength * clip(1 + 1.7 sin(b), 0, 1)
right = strength * clip(1 − 1.7 sin(b), 0, 1)
LC4 drive = 1.5 * corresponding_side
LPLC2 drive = LC4 drive * clip(angular_size / 0.6, 0, 1)
```

Strength is zero outside the forward hemisphere or when the target's relative vertical displacement exceeds 92% of its distance. This is an illustrative feature proxy. It does not compute pixels, individual ommatidia, retinotopy or learned looming selectivity. The visual-field pane shows the current pose; its numeric drives are the last applied 20 ms step.

## Motor-to-body adapter

Rates are normalized population activity, not Hz. Each power population contributes equally to the mean, irrespective of its number of represented neurons.

| Readout | Rule | Status |
|---|---|---|
| Bilateral TTMn mean J | If grounded and J ≥ 0.008, set upward velocity to 4.2 au/s. Refractory period >1 s. | Assumed threshold, velocity and refractory time |
| Mean of ten DLMn/DVMn units P | Power command p = tanh(P / 0.018) | Assumed recruitment scale |
| b2 MN right minus left B | Yaw command q = tanh(B / 0.008) | Assumed sign and scale; phase-dependent muscle mechanics absent |

For step size h=0.02, velocities are updated before position:

```
yaw_rate += h * (6 q p − 3 yaw_rate)
yaw += h * yaw_rate
vx += h * (7 p cos(yaw) − 1.7 vx)
vy += h * (7 p sin(yaw) − 1.7 vy)
vz += h * (20 lift_gain p − 9.8 − 1.1 vz)
position += h * velocity
```

Forward thrust is zero until the body is off the floor or launching. When motor output is disconnected, p and the applied yaw command are zero and launches are disabled. Raw neural readouts continue to be recorded. The body never receives target geometry directly through its motor adapter.

Ground contact clamps z≥0.45, removes downward velocity, and multiplies horizontal velocity by 0.88 per contact step. Walls clamp x,y to ±14 and reverse the corresponding velocity at 25% magnitude. The ceiling clamps z≤10 and removes upward velocity. There are no other obstacles, body collisions, leg mechanics or airflow. A constant wing drive can lift the body without a TTMn launch; this follows from the stated adapter, not a biological prediction.

Wing pose is display-only, using nine visible cycles per model second with amplitude proportional to the connected power command. It does not simulate asynchronous muscle contraction or wingbeat aerodynamics. The displayed force arrows indicate command magnitudes qualitatively.

## Run and inspect

Serve `dist` over HTTP as described in the project README, then open **Fly in an arena**. Start, pause, step 20 ms, slow playback, change the camera, or review recorded time. Resuming from a past frame first replays existing history, then continues live integration. Every setting change starts a fresh deterministic run; the circuit-experiment tab has independent settings.

The green 3D trail is the fly's computed trajectory. The dark target has prescribed motion; the fly has no prescribed trajectory. Neural colors are logarithmic; the console draws 450 strong links plus selected links, while simulating all 14,713. Readout rows do not imply direct synapses between successive rows. Export includes settings, coefficients, node identities, complete recorded rates, body states, events and source provenance.

Anatomical rendering uses locally vendored Three.js 0.180.0 (MIT). Where WebGL or the anatomy is unavailable, a labeled top-down position view retains the numerical experiment.

## Validation and reproducibility

`arena-validation.json` records results from 12 scenario/intervention checks, including zero input, stationary target, disconnected motor output, silenced readouts and alternative lift gains. The original graph's nodes, edges and denominators are preserved. The stateful neural solver agrees with the independently established batch solver within 1e-13. These checks establish implementation consistency, not physiological validity. Browser/visual/end-to-end QA was not performed.

```
node --test tests/*.test.mjs
node tests/validate_arena.mjs
python python/prepare_arena_graph.py --cache data-cache
```

Regeneration requires the aggregated source files prepared by `python/prepare_graph.py`. To rebuild display geometry separately:

```
python -m pip install -r requirements-body.txt
python python/prepare_body.py --cache body-cache
```

The anatomy source is pinned to Flybody commit `d015e9bfe441bd90ae431bac24c55cb74bdbce26`. Original OBJ checksums, decimation information and transforms are stored in `assets/flybody.json`; 81 pieces total 28,700 triangles. `assets/FLYBODY-LICENSE.txt` and `assets/FLYBODY-NOTICE.txt` accompany the modified geometry. MaleCNS attribution and data hashes are in `arena-graph.json` (CC BY 4.0). The project code retains its MIT license.
