// ==========================================
// POINT-MASS EXTERIOR BALLISTICS
// ==========================================

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const G0 = 9.80665;
const R_AIR = 287.05287;
const GAMMA_AIR = 1.4;
const SEA_LEVEL_T = 288.15;
const SEA_LEVEL_P = 101325;
const SEA_LEVEL_RHO = 1.225;

function getTerrainHeight(x, z) {
    if (typeof window !== 'undefined' && window._terrainHeightFn) return window._terrainHeightFn(x, z);
    return 0;
}

const PROJECTILE_PRESETS = Object.freeze({
    shell152Of540Like: Object.freeze({
        label: '152 мм ОФ-снаряд, учебный пресет',
        note: 'Приближенная 152 мм осколочно-фугасная форма: масса 43.5 кг, диаметр 152.4 мм, v0 655 м/с. Не является таблицей стрельбы.',
        params: Object.freeze({
            mass: 43.5,
            diameter: 0.1524,
            formFactor: 1.05,
            cdModel: 'machTable',
            cdConst: 0.33,
            v0: 655,
            angle: 45,
            azimuth: 0,
            h0: 0,
            windX: 0,
            windY: 0,
            windZ: 0,
            wind: 0,
            crosswind: 0,
            turbulence: 0,
            turbulenceScale: 450,
            length: 0.71,
            cgFromNose: 0.34,
            cpFromNose: 0.43,
            spinRpm: 9000,
            normalCoeff: 2.4,
            initialYawOffset: 0,
            initialPitchOffset: 0,
            densityScale: 1,
            dt: 0.02,
            maxTime: 220
        })
    }),
    vacuumCheck: Object.freeze({
        label: 'Вакуумная парабола',
        note: 'Контрольная конфигурация без сопротивления воздуха.',
        params: Object.freeze({
            mass: 10,
            diameter: 0.1,
            formFactor: 1,
            cdModel: 'none',
            cdConst: 0,
            v0: 300,
            angle: 35,
            azimuth: 0,
            h0: 0,
            windX: 0,
            windY: 0,
            windZ: 0,
            wind: 0,
            crosswind: 0,
            turbulence: 0,
            turbulenceScale: 450,
            length: 0.42,
            cgFromNose: 0.2,
            cpFromNose: 0.25,
            spinRpm: 0,
            normalCoeff: 0,
            initialYawOffset: 0,
            initialPitchOffset: 0,
            densityScale: 1,
            dt: 0.01,
            maxTime: 90
        })
    }),
    mortar120Like: Object.freeze({
        label: '120 мм мина, учебный пресет',
        note: 'Медленный высокий выстрел с большим сопротивлением, для проверки навесных траекторий.',
        params: Object.freeze({
            mass: 16,
            diameter: 0.12,
            formFactor: 1.35,
            cdModel: 'machTable',
            cdConst: 0.48,
            v0: 310,
            angle: 55,
            azimuth: 0,
            h0: 0,
            windX: 0,
            windY: 0,
            windZ: 0,
            wind: 0,
            crosswind: 0,
            turbulence: 0,
            turbulenceScale: 260,
            length: 0.64,
            cgFromNose: 0.29,
            cpFromNose: 0.38,
            spinRpm: 0,
            normalCoeff: 1.8,
            initialYawOffset: 0,
            initialPitchOffset: 0,
            densityScale: 1,
            dt: 0.02,
            maxTime: 180
        })
    })
});

let params = {
    preset: 'shell152Of540Like',
    ...PROJECTILE_PRESETS.shell152Of540Like.params
};

// Smooth reference projectile drag curve, expressed directly as Cd(M).
// It captures the subsonic/transonic/supersonic trend used for verification,
// not a weapon-specific firing table.
const MACH_CD_TABLE = Object.freeze([
    { mach: 0.00, cd: 0.18 },
    { mach: 0.50, cd: 0.19 },
    { mach: 0.80, cd: 0.23 },
    { mach: 0.95, cd: 0.36 },
    { mach: 1.05, cd: 0.52 },
    { mach: 1.20, cd: 0.46 },
    { mach: 1.50, cd: 0.36 },
    { mach: 2.00, cd: 0.30 },
    { mach: 2.50, cd: 0.27 },
    { mach: 3.00, cd: 0.25 }
]);

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function finiteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function vec(x = 0, y = 0, z = 0) {
    return { x, y, z };
}

function vadd(a, b) {
    return vec(a.x + b.x, a.y + b.y, a.z + b.z);
}

function vsub(a, b) {
    return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}

function vscale(a, s) {
    return vec(a.x * s, a.y * s, a.z * s);
}

function vdot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vcross(a, b) {
    return vec(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x
    );
}

function vlengthSq(a) {
    return vdot(a, a);
}

function vmag(a) {
    return Math.hypot(a.x, a.y, a.z);
}

function vnormalize(a, fallback = vec(1, 0, 0)) {
    const m = vmag(a);
    return m > 1e-12 ? vscale(a, 1 / m) : vec(fallback.x, fallback.y, fallback.z);
}

function vmulAdd(a, b, s) {
    return vec(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
}

function smoothNoise(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
    return (x - Math.floor(x)) * 2 - 1;
}

function turbulenceVelocityAt(x, y, z, t = 0, intensity = params.turbulence ?? 0, scale = params.turbulenceScale ?? 450) {
    const level = Math.max(0, finiteNumber(intensity, 0));
    if (level <= 0) return vec();

    const s = Math.max(25, finiteNumber(scale, 450));
    const nx = x / s;
    const ny = y / s;
    const nz = z / s;
    const nt = t * 0.11;
    const a = level;

    return vec(
        a * (0.62 * smoothNoise(nx + nt * 1.7) + 0.38 * smoothNoise(nz * 1.9 - nt)),
        a * 0.45 * (0.55 * smoothNoise(ny * 2.3 + nt) + 0.45 * smoothNoise(nx - nz + nt * 0.7)),
        a * (0.60 * smoothNoise(nz - nt * 1.3) + 0.40 * smoothNoise(nx * 1.4 + ny - nt))
    );
}

function airflowVelocityAt(x, y, z, t = 0, overrides = {}) {
    const windX = finiteNumber(overrides.windX, finiteNumber(params.windX, finiteNumber(params.wind, 0)));
    const windY = finiteNumber(overrides.windY, finiteNumber(params.windY, 0));
    const windZ = finiteNumber(overrides.windZ, finiteNumber(params.windZ, finiteNumber(params.crosswind, 0)));
    const turbulence = finiteNumber(overrides.turbulence, finiteNumber(params.turbulence, 0));
    const turbulenceScale = finiteNumber(overrides.turbulenceScale, finiteNumber(params.turbulenceScale, 450));
    const gust = turbulenceVelocityAt(x, y, z, t, turbulence, turbulenceScale);
    return vec(windX + gust.x, windY + gust.y, windZ + gust.z);
}

function atmosphereAt(altitudeM, densityScale = params.densityScale ?? 1) {
    const h = clamp(altitudeM, 0, 20000);
    let temperature;
    let pressure;

    if (h <= 11000) {
        const lapse = -0.0065;
        temperature = SEA_LEVEL_T + lapse * h;
        pressure = SEA_LEVEL_P * Math.pow(temperature / SEA_LEVEL_T, -G0 / (lapse * R_AIR));
    } else {
        const t11 = 216.65;
        const p11 = SEA_LEVEL_P * Math.pow(t11 / SEA_LEVEL_T, G0 / (0.0065 * R_AIR));
        temperature = t11;
        pressure = p11 * Math.exp(-G0 * (h - 11000) / (R_AIR * temperature));
    }

    const rho = pressure / (R_AIR * temperature) * densityScale;
    const speedOfSound = Math.sqrt(GAMMA_AIR * R_AIR * temperature);
    return { temperature, pressure, rho, speedOfSound };
}

function cdFromMach(mach, formFactor = params.formFactor ?? 1, cdModel = params.cdModel ?? 'machTable', cdConst = params.cdConst ?? 0.33) {
    if (cdModel === 'none') return 0;
    if (cdModel === 'constant') return Math.max(0, cdConst) * formFactor;

    const table = MACH_CD_TABLE;
    if (mach <= table[0].mach) return table[0].cd * formFactor;
    if (mach >= table[table.length - 1].mach) return table[table.length - 1].cd * formFactor;

    for (let i = 1; i < table.length; i++) {
        const lo = table[i - 1];
        const hi = table[i];
        if (mach <= hi.mach) {
            const t = (mach - lo.mach) / (hi.mach - lo.mach);
            return lerp(lo.cd, hi.cd, t) * formFactor;
        }
    }
    return cdConst * formFactor;
}

function buildProjectileConfig(overrides = {}) {
    const p = { ...params, ...overrides };
    const diameter = Math.max(0.001, finiteNumber(p.diameter, PROJECTILE_PRESETS.shell152Of540Like.params.diameter));
    const mass = Math.max(0.001, finiteNumber(p.mass, PROJECTILE_PRESETS.shell152Of540Like.params.mass));
    return {
        mass,
        diameter,
        area: Math.PI * diameter * diameter / 4,
        formFactor: Math.max(0, finiteNumber(p.formFactor, 1)),
        cdModel: p.cdModel || 'machTable',
        cdConst: Math.max(0, finiteNumber(p.cdConst, 0.33)),
        densityScale: Math.max(0, finiteNumber(p.densityScale, 1)),
        windX: finiteNumber(p.windX, finiteNumber(p.wind, 0)),
        windY: finiteNumber(p.windY, 0),
        windZ: finiteNumber(p.windZ, finiteNumber(p.crosswind, 0)),
        wind: finiteNumber(p.windX, finiteNumber(p.wind, 0)),
        crosswind: finiteNumber(p.windZ, finiteNumber(p.crosswind, 0)),
        turbulence: Math.max(0, finiteNumber(p.turbulence, 0)),
        turbulenceScale: Math.max(25, finiteNumber(p.turbulenceScale, 450)),
        length: Math.max(diameter * 1.2, finiteNumber(p.length, diameter * 4.5)),
        cgFromNose: clamp(finiteNumber(p.cgFromNose, diameter * 2.2), 0, Math.max(diameter * 1.2, finiteNumber(p.length, diameter * 4.5))),
        cpFromNose: clamp(finiteNumber(p.cpFromNose, diameter * 2.8), 0, Math.max(diameter * 1.2, finiteNumber(p.length, diameter * 4.5))),
        spinRpm: Math.max(0, finiteNumber(p.spinRpm, 0)),
        normalCoeff: Math.max(0, finiteNumber(p.normalCoeff, 2.2)),
        initialYawOffset: finiteNumber(p.initialYawOffset, 0),
        initialPitchOffset: finiteNumber(p.initialPitchOffset, 0)
    };
}

function analyticVacuumImpact(v0, angleDeg, h0 = 0, gravity = G0) {
    const theta = angleDeg * DEG2RAD;
    const vx = v0 * Math.cos(theta);
    const vy = v0 * Math.sin(theta);
    const time = (vy + Math.sqrt(vy * vy + 2 * gravity * Math.max(0, h0))) / gravity;
    const range = vx * time;
    const hMax = h0 + vy * vy / (2 * gravity);
    const impactSpeed = Math.sqrt(vx * vx + Math.pow(vy - gravity * time, 2));
    return { time, range, hMax, impactSpeed };
}

class Projectile {
    constructor(v0 = params.v0, angleDeg = params.angle, h0 = params.h0, azimuthDeg = params.azimuth, overrides = {}) {
        this.config = buildProjectileConfig(overrides);
        this.x = 0;
        this.y = Math.max(0, h0);
        this.z = 0;
        this.t = 0;
        this.landed = false;
        this.maxHeight = this.y;
        this.maxQ = 0;
        this.maxMach = 0;
        this.impactAngle = 0;
        this.impactSpeed = v0;
        this.flightPathAngle = angleDeg * DEG2RAD;
        this.mach = 0;
        this.cd = 0;
        this.drag = 0;
        this.airflowNow = vec();
        this.relativeSpeed = v0;
        this.alphaEstimate = 0;
        this.normalForceNow = 0;
        this.staticMargin = 0;
        this.aeroMoment = 0;
        this.stabilityIndex = 0;
        this.axis = vec(1, 0, 0);
        this.omega = vec();
        this.rho = SEA_LEVEL_RHO;
        this.speedOfSound = 340.3;

        const theta = angleDeg * DEG2RAD;
        const az = azimuthDeg * DEG2RAD;
        const vh = v0 * Math.cos(theta);
        this.vx = vh * Math.cos(az);
        this.vy = v0 * Math.sin(theta);
        this.vz = vh * Math.sin(az);
        this.axis = this.initialAxisFromVelocity();
        this.trail = [{ x: this.x, y: this.y, z: this.z, axis: this.axis }];
    }

    initialAxisFromVelocity() {
        const base = vnormalize(vec(this.vx, this.vy, this.vz));
        const yaw = this.config.initialYawOffset * DEG2RAD;
        const pitch = this.config.initialPitchOffset * DEG2RAD;
        let axis = vec(base.x, base.y, base.z);
        if (Math.abs(yaw) > 1e-12) {
            axis = vnormalize(vec(
                axis.x * Math.cos(yaw) - axis.z * Math.sin(yaw),
                axis.y,
                axis.x * Math.sin(yaw) + axis.z * Math.cos(yaw)
            ));
        }
        if (Math.abs(pitch) > 1e-12) {
            const lateral = vnormalize(vcross(vec(0, 1, 0), axis), vec(0, 0, 1));
            axis = vnormalize(vadd(vscale(axis, Math.cos(pitch)), vscale(vcross(lateral, axis), Math.sin(pitch))));
        }
        return axis;
    }

    relativeVelocity() {
        const air = airflowVelocityAt(this.x, this.y, this.z, this.t, this.config);
        return vec(this.vx - air.x, this.vy - air.y, this.vz - air.z);
    }

    aeroForState(state) {
        const cfg = this.config;
        const atm = atmosphereAt(state.y, cfg.densityScale);
        const air = airflowVelocityAt(state.x, state.y, state.z, state.t ?? this.t, cfg);
        const rel = vec(state.vx - air.x, state.vy - air.y, state.vz - air.z);
        const speedRel = vmag(rel);
        const mach = atm.speedOfSound > 0 ? speedRel / atm.speedOfSound : 0;
        const axis = vnormalize(state.axis || this.axis);
        const relDir = vnormalize(rel, axis);
        const dot = clamp(vdot(axis, relDir), -1, 1);
        const alpha = Math.acos(dot);
        const q = 0.5 * atm.rho * speedRel * speedRel;
        const aeroEnabled = cfg.cdModel !== 'none';
        const baseCd = cdFromMach(mach, cfg.formFactor, cfg.cdModel, cfg.cdConst);
        const cd = aeroEnabled ? baseCd * (1 + 1.8 * alpha * alpha) : 0;
        const normalCoeff = aeroEnabled ? cfg.normalCoeff : 0;
        const alphaLimited = clamp(alpha, 0, 25 * DEG2RAD);
        const normalForceMag = q * cfg.area * normalCoeff * alphaLimited;
        const dragForce = q * cd * cfg.area;
        const dragAccelMag = speedRel > 1e-9 ? dragForce / cfg.mass / speedRel : 0;
        const side = vsub(relDir, vscale(axis, dot));
        const sideDir = vnormalize(side, vec());
        const normalForce = vscale(sideDir, -normalForceMag);
        const normalAccel = vscale(normalForce, 1 / cfg.mass);

        return {
            atm,
            air,
            rel,
            relDir,
            speedRel,
            mach,
            baseCd,
            cd,
            q,
            dragForce,
            dragAccelMag,
            alpha,
            normalForceMag,
            normalForce,
            normalAccel
        };
    }

    derivatives(state) {
        const aero = this.aeroForState(state);

        return {
            dx: state.vx,
            dy: state.vy,
            dz: state.vz,
            dvx: -aero.dragAccelMag * aero.rel.x + aero.normalAccel.x,
            dvy: -G0 - aero.dragAccelMag * aero.rel.y + aero.normalAccel.y,
            dvz: -aero.dragAccelMag * aero.rel.z + aero.normalAccel.z,
            diagnostics: aero
        };
    }

    step(dt = params.dt ?? 0.02) {
        if (this.landed) return;

        const s0 = { x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, vz: this.vz, t: this.t };
        // Pre-step check
        if (getTerrainHeight(this.x, this.z) >= this.y && this.t > 1.0) {
            this.landed = true;
            return;
        }

        const k1 = this.derivatives(s0);
        const sm = {
            x: s0.x + k1.dx * dt / 2,
            y: s0.y + k1.dy * dt / 2,
            z: s0.z + k1.dz * dt / 2,
            vx: s0.vx + k1.dvx * dt / 2,
            vy: s0.vy + k1.dvy * dt / 2,
            vz: s0.vz + k1.dvz * dt / 2,
            t: s0.t + dt / 2
        };
        // Mid-step terrain check
        const midGround = getTerrainHeight(sm.x, sm.z);
        if (sm.y < midGround) {
            const f = clamp((s0.y - midGround) / Math.max(1e-9, s0.y - sm.y), 0, 1);
            this.x = lerp(s0.x, sm.x, f);
            this.y = midGround;
            this.z = lerp(s0.z, sm.z, f);
            this.t = lerp(s0.t, sm.t, f);
            this.landed = true;
            this.trail.push({ x: this.x, y: this.y, z: this.z });
            return;
        }
        const k2 = this.derivatives(sm);
        const k3 = this.derivatives({
            x: s0.x + k2.dx * dt / 2,
            y: s0.y + k2.dy * dt / 2,
            z: s0.z + k2.dz * dt / 2,
            vx: s0.vx + k2.dvx * dt / 2,
            vy: s0.vy + k2.dvy * dt / 2,
            vz: s0.vz + k2.dvz * dt / 2,
            t: s0.t + dt / 2
        });
        const k4 = this.derivatives({
            x: s0.x + k3.dx * dt,
            y: s0.y + k3.dy * dt,
            z: s0.z + k3.dz * dt,
            vx: s0.vx + k3.dvx * dt,
            vy: s0.vy + k3.dvy * dt,
            vz: s0.vz + k3.dvz * dt,
            t: s0.t + dt
        });

        const prev = { x: this.x, y: this.y, z: this.z, t: this.t, vx: this.vx, vy: this.vy, vz: this.vz };
        this.x += dt / 6 * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
        this.y += dt / 6 * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy);
        this.z += dt / 6 * (k1.dz + 2 * k2.dz + 2 * k3.dz + k4.dz);
        this.vx += dt / 6 * (k1.dvx + 2 * k2.dvx + 2 * k3.dvx + k4.dvx);
        this.vy += dt / 6 * (k1.dvy + 2 * k2.dvy + 2 * k3.dvy + k4.dvy);
        this.vz += dt / 6 * (k1.dvz + 2 * k2.dvz + 2 * k3.dvz + k4.dvz);
        this.t += dt;

        const diag = this.derivatives({ x: this.x, y: Math.max(0, this.y), z: this.z, vx: this.vx, vy: this.vy, vz: this.vz, t: this.t }).diagnostics;
        this.updateAttitude(dt, diag);
        this.rho = diag.atm.rho;
        this.speedOfSound = diag.atm.speedOfSound;
        this.mach = diag.mach;
        this.cd = diag.cd;
        this.drag = diag.dragForce;
        this.airflowNow = diag.air;
        this.relativeSpeed = diag.speedRel;
        this.maxQ = Math.max(this.maxQ, diag.q);
        this.maxMach = Math.max(this.maxMach, diag.mach);
        this.maxHeight = Math.max(this.maxHeight, this.y);
        this.flightPathAngle = Math.atan2(this.vy, Math.hypot(this.vx, this.vz));
        this.updateStabilityDiagnostics(diag);
        this.impactSpeed = this.getSpeed();

        const groundY = getTerrainHeight(this.x, this.z);
        if (this.y <= groundY && this.t > 0) {
            const denom = prev.y - this.y;
            const f = denom > 1e-9 ? clamp((prev.y - groundY) / denom, 0, 1) : 1;
            this.x = lerp(prev.x, this.x, f);
            this.y = groundY;
            this.z = lerp(prev.z, this.z, f);
            this.t = lerp(prev.t, this.t, f);
            this.vx = lerp(prev.vx, this.vx, f);
            this.vy = lerp(prev.vy, this.vy, f);
            this.vz = lerp(prev.vz, this.vz, f);
            this.impactAngle = Math.atan2(-this.vy, Math.hypot(this.vx, this.vz));
            this.impactSpeed = this.getSpeed();
            this.landed = true;
        }

        const last = this.trail[this.trail.length - 1];
        if (!last || Math.hypot(this.x - last.x, this.y - last.y, this.z - last.z) > 20 || this.landed) {
            this.trail.push({ x: this.x, y: this.y, z: this.z, axis: this.axis });
            if (this.trail.length > 2200) this.trail.shift();
        }
    }

    run(maxTime = params.maxTime ?? 220, dt = params.dt ?? 0.02) {
        while (!this.landed && this.t < maxTime) {
            this.step(dt);
        }
        return this;
    }

    getSpeed() {
        return Math.hypot(this.vx, this.vy, this.vz);
    }

    getHorizontalRange() {
        return Math.hypot(this.x, this.z);
    }

    getKineticEnergy() {
        return 0.5 * this.config.mass * this.getSpeed() * this.getSpeed();
    }

    getSectionalDensity() {
        return this.config.mass / this.config.area;
    }

    updateStabilityDiagnostics(diag = null) {
        const cfg = this.config;
        const lever = cfg.cpFromNose - cfg.cgFromNose;
        this.alphaEstimate = diag?.alpha ?? this.alphaEstimate;
        this.staticMargin = cfg.length > 0 ? lever / cfg.length : 0;
        this.normalForceNow = diag?.normalForceMag ?? this.normalForceNow;
        this.aeroMoment = this.normalForceNow * lever;
        const spinRad = cfg.spinRpm * 2 * Math.PI / 60;
        this.stabilityIndex = cfg.diameter > 0
            ? Math.max(0, spinRad * cfg.diameter / Math.max(diag?.speedRel ?? this.relativeSpeed, 1))
            : 0;
    }

    updateAttitude(dt, diag) {
        const cfg = this.config;
        const lever = cfg.cpFromNose - cfg.cgFromNose;
        const inertia = Math.max(
            cfg.mass * (cfg.length * cfg.length + 3 * Math.pow(cfg.diameter / 2, 2)) / 12,
            cfg.mass * cfg.diameter * cfg.diameter * 0.02
        );
        const spinRad = cfg.spinRpm * 2 * Math.PI / 60;
        const stabilityIndex = cfg.diameter > 0
            ? Math.max(0, spinRad * cfg.diameter / Math.max(diag.speedRel, 1))
            : 0;
        const alignAxis = vcross(this.axis, diag.relDir);
        const torque = vscale(alignAxis, diag.normalForceMag * lever);
        const gyroFactor = 1 + stabilityIndex * 4;
        const angularAccel = vscale(torque, 1 / (inertia * gyroFactor));
        const damping = 1.2 + stabilityIndex * 3.0 + Math.abs(lever) / Math.max(cfg.length, 1e-6) * 1.5;

        this.omega = vadd(this.omega, vscale(angularAccel, dt));
        this.omega = vscale(this.omega, Math.exp(-damping * dt));
        const omegaMag = vmag(this.omega);
        if (omegaMag > 30) this.omega = vscale(this.omega, 30 / omegaMag);

        const axisRate = vcross(this.omega, this.axis);
        this.axis = vnormalize(vadd(this.axis, vscale(axisRate, dt)), this.axis);
    }
}

function simulateShot(overrides = {}) {
    const p = { ...params, ...overrides };
    if (overrides.wind !== undefined && overrides.windX === undefined) p.windX = overrides.wind;
    if (overrides.crosswind !== undefined && overrides.windZ === undefined) p.windZ = overrides.crosswind;
    const shot = new Projectile(
        finiteNumber(p.v0, params.v0),
        finiteNumber(p.angle, params.angle),
        finiteNumber(p.h0, params.h0),
        finiteNumber(p.azimuth, params.azimuth),
        p
    );
    shot.run(finiteNumber(p.maxTime, params.maxTime), finiteNumber(p.dt, params.dt));
    return shot;
}
