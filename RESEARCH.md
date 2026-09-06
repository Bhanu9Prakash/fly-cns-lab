# Feasibility research and experiment findings

Research and data retrieval: 6 September 2026.

## Why this is possible

Janelia's MaleCNS connectome spans the brain, optic lobes and ventral nerve cord, including the neck connection. That makes it possible to follow a measured structural route from visual circuits into the cord. The public downloads include annotations, predicted neurotransmitters and directed synapse counts, so the initial model does not require a terabyte-scale EM image reconstruction. The flat data also removes the need for an authenticated neuPrint API request. [Janelia overview](https://www.janelia.org/project-team/flyem/male-cns-connectome), [official data documentation](https://male-cns.janelia.org/download/).

There is a research precedent for connectome-constrained dynamics. Shiu et al. constructed a leaky integrate-and-fire model using FlyWire connectivity and neurotransmitter predictions, and tested predictions in feeding and grooming circuits. The important precedent is experimentally testable sensorimotor hypotheses. It does not establish that arbitrary visual stimulation on a different connectome and model is already accurate. [Shiu et al., Nature, 2024](https://www.nature.com/articles/s41586-024-07763-9).

Three practical approaches were considered:

| Approach | What it answers | Main cost or limitation |
|---|---|---|
| Unsigned weighted graph spread | Where structural influence can travel | Cannot model inhibition or claim physiology |
| Population-rate dynamics, implemented here | How signed activity and interventions interact at type level | Loses single-cell differences and retinotopy; requires explicit response assumptions |
| Individual-neuron spiking model with retina and body | Finer sensory computation, spike timing and behavior | Needs receptor/dynamics calibration, spatial input, gap junctions and experimental validation |

A bounded population-rate model is a useful first computational twin because it is transparent, fast enough to manipulate interactively, and available at both cropped and full typed-CNS scales.

## Visual input and biological endpoints

The looming experiment stimulates LC4 and LPLC2 feature populations. Experimental work identifies their direct synapses onto the giant fiber pathway and distinguishes size and velocity contributions. That supports choosing those channels; it does not determine the exact input curves in this prototype. [Ache et al., Current Biology, 2019](https://pubmed.ncbi.nlm.nih.gov/30827912/).

The motion presets stimulate T4a/T5a or T4b/T5b, which are direction-selective visual populations. Pooling an entire type removes within-eye receptive-field positions. Therefore, the visible moving pattern is a stimulus illustration, not an image fed through simulated photoreceptors. [Henning et al., 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8769539/).

DNg13 is a descending steering neuron. It should not be conflated with a motor neuron innervating a muscle. This prototype follows the graph onward to populations explicitly annotated as `cb_motor` or `vnc_motor`. [Yang et al., Cell, 2024](https://pubmed.ncbi.nlm.nih.gov/39293446/).

## Actual data preparation

The importer read three official v1.0 Feather files. Exact URLs, file sizes and SHA-256 hashes are retained in `dist/graph.json`:

1. Curated body annotations, about 14.5 MB.
2. Body neurotransmitter predictions, about 43.3 MB.
3. The full segment-to-segment connection table, about 1.05 GB.

The connection table contains 151,856,684 segment pairs, including small segments outside the modeled neuron set. After retaining named, Traced neurons and grouping by cell type, side, and VNC soma neuromere, there are **162,517 neurons, 25,850 units and 6,742,293 directed population links**. Each unit uses the modal consensus transmitter; all 414 units in the interactive subnetwork have complete within-unit transmitter agreement. Broader full-model units can have heterogeneous assignments, which this modal representation simplifies.

For the browser, a fixed selection uses six unsigned input-normalized propagation rounds with anatomical group quotas. It preserves strong-path ancestors and existing bilateral counterparts, explicitly includes DNp01 and DNg13, and retains every measured edge among selected units. The result contains **414 populations, 9,175 neurons, 10,783 links and 2,758,076 represented synapses**. There are 91 visual, 100 central, 82 descending, 91 nerve-cord/ascending, and 50 motor population units.

Every target's normalization denominator includes all its original incoming synapse counts, even from unmodeled raw segments. Neither cropping nor silencing renormalizes the retained edges. Missing inputs are silent. No missing edge is fabricated.

## Implemented model

For presynaptic population j and postsynaptic population i:

W_ij = sign_j × observed_synapse_count_ji / total_original_input_i

r_i(t + dt) = r_i(t) + alpha × [max(0, tanh(I_i(t) + gain × sum_j W_ij r_j(t))) − r_i(t)]

alpha = 1 − exp(−dt / tau)

All units update from the previous state simultaneously. Activity begins at zero and remains in [0,1]. Defaults are dt=2 ms, tau=20 ms, 600 model ms duration, gain=3, and input amplitude=1. The assigned milliseconds are illustrative model parameters. The output is normalized population activity, not measured firing rate, physiological latency, behavior probability, muscle force or movement.

Acetylcholine is excitatory; GABA and histamine are inhibitory. Glutamate is inhibitory by default but can be made excitatory or omitted. Receptor-specific signs are unknown. Unknown/modulatory outputs are omitted from the fast signed dynamics. Unsigned mode sets all signs positive and is only a structural propagation control. A global glutamate-sign sensitivity experiment has precedent in Shiu et al.; it is an uncertainty test, not a biological conclusion. [Shiu et al., methods](https://www.nature.com/articles/s41586-024-07763-9).

Looming input lasts from t=60 to t<240. For phase q from 0 to 1, LC4 receives amplitude × (0.35 + 0.65q), and LPLC2 receives amplitude × q². These hand-specified feature envelopes represent increasing velocity/size drive qualitatively. Motion inputs are constant pulses. No-stimulus input is zero. Silencing clamps selected rates to zero, with the intact graph normalization unchanged.

## What the runs actually showed

At default bilateral looming settings:

| Population | Browser subnetwork peak | Full typed-CNS peak | Full CNS peak after both DNp01 units silenced | Relative full-model change |
|---|---:|---:|---:|---:|
| TTMn, R, T2 | 0.034008 | 0.024912 | 0.000231 | −99.1% |
| TTMn, L, T2 | 0.015891 | 0.010734 | 0.001020 | −90.5% |
| hDVM MN, L, T3 | 0.023850 | 0.038544 | 0.037324 | −3.2% |
| hDVM MN, R, T3 | 0.019989 | 0.031116 | 0.030138 | −3.1% |

These are model results. The different sensitivities suggest a useful hypothesis: the chosen motor populations depend differently on the giant fiber pathway under this parameterization. This should be tested with larger physiology-aware models and recordings before any behavioral inference. Gap junctions are absent, which is particularly consequential for giant fiber circuit interpretation.

The full-network comparison matters. Cropping overstates right TTMn peak by 36.5% and understates left hDVM by 38.1%. DNg13 is silent in the cropped looming run yet weakly active in the full model. The full model's top motor ranking also differs. Keeping full input denominators is necessary but does not restore omitted recurrent influences. The small explorer is useful for rapid experiments; it is not a numerically faithful substitute for the full model.

In the browser subnetwork, changing the glutamate assumption can change the top-ranked motor population for motion channel B. This demonstrates why transmitter assumptions are exposed rather than buried in code. It does not measure biological uncertainty bounds.

## Verification and limits

- Seven JavaScript behavioral tests pass: no input, causal direction, silencing, inhibition, reversed edges, deterministic bounded feedback and invalid inputs.
- The full real subnetwork has valid, unique, positive-count directed edges, valid population IDs and reachable structural routes from the input set.
- Browser and scalar Python trajectories agree within 1.11e-16 absolute activity at default settings.
- The sparse Python solver matches the scalar model on controlled circuits under default, silenced, excitatory-glutamate, zero-input and unsigned settings.
- The full typed-CNS no-input control remains exactly silent.
- No electrophysiological or behavioral validation has been performed. Browser visual/end-to-end QA was not performed.

The next scientific step is fitting the simplest uncertain parameters against recorded responses in one visual circuit, with held-out input conditions. Preserve individual neurons and their retinotopy when adding a retina; obtain receptor-aware effects and electrical connectivity where possible. The new arena adds an explicitly illustrative body and geometric feedback before calibration, to make the software loop inspectable; interpreting it as biological behavior still requires those validation steps.

## Embodied arena extension

The follow-up implementation adds real DLM/DVM wing motor and b2 steering populations to a 526-unit graph, with a closed sensory-to-motor-to-body feedback loop. hDVM populations in the earlier table are **haltere power** neurons, not wing power. The body uses an attributed, decimated Flybody anatomical mesh and separate unfitted force rules. [Embodiment research, equations and reproduction](dist/EMBODIMENT.md) documents this addition. The original 414-unit experiment and full-CNS results are retained.
