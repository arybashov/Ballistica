// ==========================================
// MLP NEURAL NETWORK — PURE JS
// ==========================================
// Прямая/обратная задача баллистики.
// forward() — предсказание, train() — обучение, predict() — удобная обёртка.

(function () {
    class NeuralNetwork {
        constructor(layers) {
            this.layers = layers; // [8, 128, 64, 4] — размеры слоёв
            this.weights = [];
            this.biases = [];
            this.activations = [];
            this._initWeights();
        }

        _initWeights() {
            for (let i = 0; i < this.layers.length - 1; i++) {
                const fanIn = this.layers[i];
                const fanOut = this.layers[i + 1];
                const std = Math.sqrt(2.0 / fanIn); // He init for ReLU
                const w = [];
                for (let j = 0; j < fanOut; j++) {
                    const row = [];
                    for (let k = 0; k < fanIn; k++) {
                        row.push(this._randn() * std);
                    }
                    w.push(row);
                }
                this.weights.push(w);
                const b = new Array(fanOut).fill(0);
                this.biases.push(b);
            }
        }

        _randn() {
            let u = 0, v = 0;
            while (u === 0) u = Math.random();
            while (v === 0) v = Math.random();
            return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        }

        _relu(x) { return Math.max(0, x); }
        _reluDeriv(x) { return x > 0 ? 1 : 0; }

        _sigmoid(x) { return 1.0 / (1.0 + Math.exp(-x)); }
        _sigmoidDeriv(x) { const s = this._sigmoid(x); return s * (1 - s); }

        forward(input, activation = 'relu') {
            this.activations = [input.slice()];
            let current = input.slice();
            for (let i = 0; i < this.weights.length; i++) {
                const next = [];
                const w = this.weights[i];
                const b = this.biases[i];
                const isOutput = (i === this.weights.length - 1);
                for (let j = 0; j < w.length; j++) {
                    let sum = b[j];
                    for (let k = 0; k < current.length; k++) {
                        sum += w[j][k] * current[k];
                    }
                    if (isOutput) {
                        next.push(sum); // linear output
                    } else {
                        next.push(activation === 'relu' ? this._relu(sum) : this._sigmoid(sum));
                    }
                }
                this.activations.push(next.slice());
                current = next;
            }
            return current;
        }

        train(inputs, targets, opts = {}) {
            // inputs: array of [v0, angle, ...]
            // targets: array of [range, time, ...]
            const lr = opts.lr || 0.001;
            const epochs = opts.epochs || 100;
            const batchSize = opts.batchSize || 32;
            const activation = opts.activation || 'relu';
            const onEpoch = opts.onEpoch || null;
            const history = [];

            for (let epoch = 0; epoch < epochs; epoch++) {
                // Shuffle
                const indices = Array.from({ length: inputs.length }, (_, i) => i);
                for (let i = indices.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [indices[i], indices[j]] = [indices[j], indices[i]];
                }

                let totalLoss = 0;
                for (let b = 0; b < inputs.length; b += batchSize) {
                    const batchIndices = indices.slice(b, Math.min(b + batchSize, inputs.length));
                    const gradW = this.weights.map(w => w.map(row => row.map(() => 0)));
                    const gradB = this.biases.map(b => b.map(() => 0));
                    let batchLoss = 0;

                    for (const idx of batchIndices) {
                        const inp = inputs[idx];
                        const tgt = targets[idx];
                        const pred = this.forward(inp, activation);

                        // MSE loss
                        const errors = pred.map((p, i) => p - tgt[i]);
                        batchLoss += errors.reduce((s, e) => s + e * e, 0) / errors.length;

                        // Backprop
                        let delta = errors.slice();
                        for (let i = this.weights.length - 1; i >= 0; i--) {
                            const act = this.activations[i + 1]; // output of this layer
                            const prevAct = this.activations[i]; // input to this layer
                            const isOutput = (i === this.weights.length - 1);

                            for (let j = 0; j < delta.length; j++) {
                                if (!isOutput) {
                                    delta[j] *= (activation === 'relu' ? this._reluDeriv(act[j]) : this._sigmoidDeriv(prevAct[j]));
                                }
                                gradB[i][j] += delta[j];
                                for (let k = 0; k < prevAct.length; k++) {
                                    gradW[i][j][k] += delta[j] * prevAct[k];
                                }
                            }

                            if (i > 0) {
                                const nextDelta = new Array(this.layers[i]).fill(0);
                                for (let j = 0; j < delta.length; j++) {
                                    for (let k = 0; k < nextDelta.length; k++) {
                                        nextDelta[k] += this.weights[i][j][k] * delta[j];
                                    }
                                }
                                delta = nextDelta;
                            }
                        }
                    }

                    const n = batchIndices.length;
                    for (let i = 0; i < this.weights.length; i++) {
                        for (let j = 0; j < this.weights[i].length; j++) {
                            for (let k = 0; k < this.weights[i][j].length; k++) {
                                this.weights[i][j][k] -= lr * gradW[i][j][k] / n;
                            }
                            this.biases[i][j] -= lr * gradB[i][j] / n;
                        }
                    }
                    totalLoss += batchLoss;
                }

                const avgLoss = totalLoss / inputs.length;
                history.push({ epoch, loss: avgLoss });
                if (onEpoch) onEpoch(epoch, avgLoss);
            }
            return history;
        }

        predict(input, activation = 'relu') {
            return this.forward(input, activation);
        }

        toJSON() {
            return {
                layers: this.layers,
                weights: this.weights,
                biases: this.biases,
            };
        }

        static fromJSON(json) {
            const nn = new NeuralNetwork(json.layers);
            nn.weights = json.weights;
            nn.biases = json.biases;
            return nn;
        }

        save(key) {
            try { localStorage.setItem('nn_' + key, JSON.stringify(this.toJSON())); } catch (_) {}
        }

        static load(key) {
            try {
                const raw = localStorage.getItem('nn_' + key);
                if (raw) return NeuralNetwork.fromJSON(JSON.parse(raw));
            } catch (_) {}
            return null;
        }
    }

    window.NeuralNetwork = NeuralNetwork;

    // ── Ballistics-specific helpers ─────────────────────────────────────

    window.BallisticsNN = {
        // Direct: (v0, angle, azimuth, h0, windX, windY, windZ, mass) → (range, time, impactAngle, energy)
        DIRECT_LAYERS: [8, 128, 64, 4],
        DIRECT_INPUT_KEYS: ['v0', 'angle', 'azimuth', 'h0', 'windX', 'windY', 'windZ', 'mass'],
        DIRECT_OUTPUT_KEYS: ['range', 'time', 'impactAngle', 'energy'],

        // Inverse: (targetRange, targetLateral, windX, windZ, mass) → (angle, azimuth)
        INVERSE_LAYERS: [5, 96, 48, 2],

        createDirect() {
            return new NeuralNetwork(this.DIRECT_LAYERS);
        },

        createInverse() {
            return new NeuralNetwork(this.INVERSE_LAYERS);
        },

        fitDirectStats(samples) {
            if (!samples || samples.length === 0) {
                return {
                    mins: {},
                    maxs: {},
                    inputKeys: this.DIRECT_INPUT_KEYS.slice(),
                    outputKeys: this.DIRECT_OUTPUT_KEYS.slice()
                };
            }
            const keys = this.DIRECT_INPUT_KEYS;
            const outKeys = this.DIRECT_OUTPUT_KEYS;
            const mins = {}, maxs = {};

            for (const k of [...keys, ...outKeys]) {
                const vals = samples.map(s => s[k]).filter(v => v !== undefined && v !== null);
                mins[k] = Math.min(...vals);
                maxs[k] = Math.max(...vals);
            }

            return {
                mins,
                maxs,
                inputKeys: keys.slice(),
                outputKeys: outKeys.slice()
            };
        },

        normalizeDirectWithStats(samples, stats) {
            if (!samples || samples.length === 0) {
                return {
                    inputs: [],
                    targets: [],
                    mins: stats ? stats.mins : {},
                    maxs: stats ? stats.maxs : {},
                    inputKeys: stats ? stats.inputKeys : this.DIRECT_INPUT_KEYS.slice(),
                    outputKeys: stats ? stats.outputKeys : this.DIRECT_OUTPUT_KEYS.slice()
                };
            }
            const keys = (stats && stats.inputKeys) || this.DIRECT_INPUT_KEYS;
            const outKeys = (stats && stats.outputKeys) || this.DIRECT_OUTPUT_KEYS;
            const mins = stats.mins;
            const maxs = stats.maxs;

            const inputs = samples.map(s => keys.map(k => {
                const range = maxs[k] - mins[k];
                return range > 1e-9 ? (s[k] - mins[k]) / range : 0;
            }));

            const targets = samples.map(s => outKeys.map(k => {
                const range = maxs[k] - mins[k];
                return range > 1e-9 ? (s[k] - mins[k]) / range : 0;
            }));

            return { inputs, targets, mins, maxs, inputKeys: keys.slice(), outputKeys: outKeys.slice() };
        },

        normalizeInputs(samples) {
            const stats = this.fitDirectStats(samples);
            return this.normalizeDirectWithStats(samples, stats);
        },

        denormalize(output, mins, maxs, outKeys) {
            const keys = outKeys || ['range', 'time', 'impactAngle', 'energy'];
            return keys.map((k, i) => {
                const range = maxs[k] - mins[k];
                return output[i] * range + mins[k];
            });
        },

        saveDirectBundle(key, bundle) {
            if (!bundle || !bundle.model || !bundle.stats) return;
            try {
                localStorage.setItem('nn_bundle_' + key, JSON.stringify(bundle));
            } catch (_) {}
        },

        loadDirectBundle(key) {
            try {
                const raw = localStorage.getItem('nn_bundle_' + key);
                if (!raw) return null;
                const bundle = JSON.parse(raw);
                if (!bundle || !bundle.model || !bundle.stats) return null;
                bundle.nn = NeuralNetwork.fromJSON(bundle.model);
                return bundle;
            } catch (_) {
                return null;
            }
        },

        normalizeInverse(samples) {
            if (!samples || samples.length === 0) return { inputs: [], targets: [], mins: {}, maxs: {} };
            const inKeys = ['targetRange', 'targetLateral', 'windX', 'windZ', 'mass'];
            const outKeys = ['angle', 'azimuth'];
            const mins = {}, maxs = {};
            for (const k of [...inKeys, ...outKeys]) {
                const vals = samples.map(s => s[k]).filter(v => v !== undefined);
                mins[k] = Math.min(...vals);
                maxs[k] = Math.max(...vals);
            }
            const inputs = samples.map(s => inKeys.map(k => {
                const r = maxs[k] - mins[k];
                return r > 1e-9 ? (s[k] - mins[k]) / r : 0;
            }));
            const targets = samples.map(s => outKeys.map(k => {
                const r = maxs[k] - mins[k];
                return r > 1e-9 ? (s[k] - mins[k]) / r : 0;
            }));
            return { inputs, targets, mins, maxs };
        },

        denormalizeInverse(output, mins, maxs) {
            return ['angle', 'azimuth'].map((k, i) => {
                const r = maxs[k] - mins[k];
                return output[i] * r + mins[k];
            });
        },
    };
})();
