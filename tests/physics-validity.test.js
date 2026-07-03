const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPhysics() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'physics.js'), 'utf8');
    const context = { console, Math };
    vm.createContext(context);
    vm.runInContext(`${source}
this.params = params;
this.PROJECTILE_PRESETS = PROJECTILE_PRESETS;
this.MACH_CD_TABLE = MACH_CD_TABLE;
this.DEG2RAD = DEG2RAD;
this.RAD2DEG = RAD2DEG;
this.G0 = G0;
this.atmosphereAt = atmosphereAt;
this.airflowVelocityAt = airflowVelocityAt;
this.cdFromMach = cdFromMach;
this.buildProjectileConfig = buildProjectileConfig;
this.analyticVacuumImpact = analyticVacuumImpact;
this.Projectile = Projectile;
this.simulateShot = simulateShot;
`, context);
    return context;
}

function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

test('standard atmosphere matches sea level and 11 km reference values', () => {
    const ctx = loadPhysics();
    const sea = ctx.atmosphereAt(0);
    const tropopause = ctx.atmosphereAt(11000);

    assert.ok(Math.abs(sea.rho - 1.225) < 0.003);
    assert.ok(Math.abs(sea.speedOfSound - 340.3) < 0.5);
    assert.ok(Math.abs(tropopause.rho - 0.364) < 0.01);
    assert.ok(Math.abs(tropopause.speedOfSound - 295.1) < 0.7);
});

test('Mach drag table has a transonic drag rise and finite interpolation', () => {
    const ctx = loadPhysics();
    const sub = ctx.cdFromMach(0.7, 1, 'machTable', 0.3);
    const trans = ctx.cdFromMach(1.05, 1, 'machTable', 0.3);
    const sup = ctx.cdFromMach(2.0, 1, 'machTable', 0.3);

    assert.ok(sub > 0.18 && sub < 0.24);
    assert.ok(trans > sub * 2);
    assert.ok(sup < trans);
    assert.equal(ctx.cdFromMach(2, 1.2, 'constant', 0.4), 0.48);
    assert.equal(ctx.cdFromMach(2, 1, 'none', 0.4), 0);
});

test('vacuum shot agrees with analytic parabola', () => {
    const ctx = loadPhysics();
    const overrides = {
        cdModel: 'none',
        v0: 320,
        angle: 37,
        h0: 12,
        dt: 0.005,
        maxTime: 120
    };
    const shot = ctx.simulateShot(overrides);
    const exact = ctx.analyticVacuumImpact(overrides.v0, overrides.angle, overrides.h0);

    assert.ok(Math.abs(shot.x - exact.range) / exact.range < 0.001, `${shot.x} vs ${exact.range}`);
    assert.ok(Math.abs(shot.t - exact.time) / exact.time < 0.001, `${shot.t} vs ${exact.time}`);
    assert.ok(Math.abs(shot.maxHeight - exact.hMax) / exact.hMax < 0.001, `${shot.maxHeight} vs ${exact.hMax}`);
});

test('drag reduces range and impact speed relative to vacuum', () => {
    const ctx = loadPhysics();
    const base = { v0: 655, angle: 45, h0: 0, wind: 0, crosswind: 0, dt: 0.02 };
    const vacuum = ctx.simulateShot({ ...base, cdModel: 'none' });
    const drag = ctx.simulateShot({ ...base, cdModel: 'machTable', mass: 43.5, diameter: 0.1524, formFactor: 1.05 });

    assert.ok(drag.getHorizontalRange() < vacuum.getHorizontalRange() * 0.55, `drag range ${drag.getHorizontalRange()} should be far below vacuum ${vacuum.getHorizontalRange()}`);
    assert.ok(drag.impactSpeed < vacuum.impactSpeed * 0.75);
    assert.ok(drag.maxQ > 100000);
});

test('152 mm preset stays in a plausible educational range band', () => {
    const ctx = loadPhysics();
    Object.assign(ctx.params, ctx.PROJECTILE_PRESETS.shell152Of540Like.params);
    const shot = new ctx.Projectile(ctx.params.v0, ctx.params.angle, ctx.params.h0, ctx.params.azimuth);
    shot.run(ctx.params.maxTime, ctx.params.dt);

    assert.ok(shot.landed, 'shot should land');
    assert.ok(shot.getHorizontalRange() > 12000, `range too short: ${shot.getHorizontalRange()}`);
    assert.ok(shot.getHorizontalRange() < 22000, `range too long for this approximate drag model: ${shot.getHorizontalRange()}`);
    assert.ok(shot.maxHeight > 4500, `apogee too low: ${shot.maxHeight}`);
    assert.ok(shot.t > 45 && shot.t < 95, `time of flight out of expected band: ${shot.t}`);
    assert.ok(shot.maxMach > 1.8, `launch should be supersonic: ${shot.maxMach}`);
});

test('crosswind creates lateral drift in the wind direction', () => {
    const ctx = loadPhysics();
    const calm = ctx.simulateShot({ v0: 400, angle: 35, cdModel: 'machTable', crosswind: 0, wind: 0 });
    const windy = ctx.simulateShot({ v0: 400, angle: 35, cdModel: 'machTable', crosswind: 12, wind: 0 });

    assert.ok(Math.abs(calm.z) < 1e-6);
    assert.ok(windy.z > 20, `expected positive drift, got ${windy.z}`);
});

test('3D wind supports vertical flow and renamed wind axes', () => {
    const ctx = loadPhysics();
    const calm = ctx.simulateShot({ v0: 300, angle: 35, windX: 0, windY: 0, windZ: 0, turbulence: 0 });
    const updraft = ctx.simulateShot({ v0: 300, angle: 35, windX: 0, windY: 18, windZ: 0, turbulence: 0 });
    const side = ctx.simulateShot({ v0: 300, angle: 35, windX: 0, windY: 0, windZ: 18, turbulence: 0 });

    assert.ok(updraft.t > calm.t, 'vertical wind should alter time aloft');
    assert.ok(updraft.maxHeight > calm.maxHeight, 'updraft should increase apogee in the point-mass model');
    assert.ok(side.z > 20, 'windZ should create lateral drift');
});

test('turbulence is deterministic and changes the trajectory without random RK4 noise', () => {
    const ctx = loadPhysics();
    const a = ctx.simulateShot({ v0: 360, angle: 32, turbulence: 12, turbulenceScale: 300 });
    const b = ctx.simulateShot({ v0: 360, angle: 32, turbulence: 12, turbulenceScale: 300 });
    const calm = ctx.simulateShot({ v0: 360, angle: 32, turbulence: 0 });

    assert.ok(Math.abs(a.x - b.x) < 1e-9);
    assert.ok(Math.abs(a.z - b.z) < 1e-9);
    assert.ok(Math.abs(a.getHorizontalRange() - calm.getHorizontalRange()) > 1, 'gust field should change range');
});

test('CG and center of pressure are clamped and exposed as stability diagnostics', () => {
    const ctx = loadPhysics();
    const shot = ctx.simulateShot({
        v0: 420,
        angle: 20,
        length: 0.7,
        cgFromNose: 0.32,
        cpFromNose: 0.48,
        spinRpm: 9000,
        windY: 8
    });
    const clamped = ctx.buildProjectileConfig({ length: 0.7, cgFromNose: -1, cpFromNose: 9 });

    assert.equal(clamped.cgFromNose, 0);
    assert.equal(clamped.cpFromNose, 0.7);
    assert.ok(shot.staticMargin > 0, 'CP aft of CG should show positive static margin');
    assert.ok(Number.isFinite(shot.aeroMoment));
    assert.ok(shot.stabilityIndex > 0, 'spin should appear in stability diagnostics');
});

test('CG, center of pressure, and spin change projectile behavior', () => {
    const ctx = loadPhysics();
    const base = {
        v0: 500,
        angle: 30,
        windY: 25,
        windZ: 10,
        turbulence: 0,
        initialYawOffset: 4,
        initialPitchOffset: 2,
        maxTime: 120
    };
    const stable = ctx.simulateShot({ ...base, cgFromNose: 0.32, cpFromNose: 0.48, spinRpm: 12000 });
    const neutral = ctx.simulateShot({ ...base, cgFromNose: 0.40, cpFromNose: 0.40, spinRpm: 0 });
    const spinless = ctx.simulateShot({ ...base, cgFromNose: 0.32, cpFromNose: 0.48, spinRpm: 0 });
    const fastSpin = ctx.simulateShot({ ...base, cgFromNose: 0.32, cpFromNose: 0.48, spinRpm: 20000 });

    assert.ok(Math.abs(stable.getHorizontalRange() - neutral.getHorizontalRange()) > 200, 'moving CP relative to CG should alter range');
    assert.ok(Math.abs(stable.maxHeight - neutral.maxHeight) > 100, 'moving CP relative to CG should alter vertical behavior');
    assert.ok(Math.abs(fastSpin.getHorizontalRange() - spinless.getHorizontalRange()) > 200, 'spin damping should alter trajectory under angle of attack');
    assert.notEqual(stable.aeroMoment, 0, 'nonzero CP-CG lever should create a real aerodynamic moment');
});

test('reversing CP ahead of CG destabilizes the simplified attitude model', () => {
    const ctx = loadPhysics();
    const base = {
        v0: 500,
        angle: 30,
        windY: 25,
        windZ: 10,
        turbulence: 0,
        initialYawOffset: 4,
        initialPitchOffset: 2,
        spinRpm: 0,
        maxTime: 120
    };
    const stable = ctx.simulateShot({ ...base, cgFromNose: 0.32, cpFromNose: 0.48 });
    const reversed = ctx.simulateShot({ ...base, cgFromNose: 0.48, cpFromNose: 0.32 });

    assert.ok(reversed.getHorizontalRange() < stable.getHorizontalRange() * 0.6, 'CP ahead of CG should be visibly worse in this model');
    assert.ok(reversed.staticMargin < 0, 'reversed case should report negative static margin');
});

test('heavier projectile with same diameter retains range better', () => {
    const ctx = loadPhysics();
    const light = ctx.simulateShot({ v0: 500, angle: 40, mass: 20, diameter: 0.1524, cdModel: 'machTable' });
    const heavy = ctx.simulateShot({ v0: 500, angle: 40, mass: 50, diameter: 0.1524, cdModel: 'machTable' });

    assert.ok(heavy.x > light.x * 1.25, `heavy ${heavy.x} should outrange light ${light.x}`);
    assert.ok(heavy.impactSpeed > light.impactSpeed);
});

test('Projectile constructor accepts explicit overrides without touching global params', () => {
    const ctx = loadPhysics();
    const originalMass = ctx.params.mass;
    const shot = new ctx.Projectile(200, 30, 0, 0, { mass: 5, diameter: undefined, wind: 'bad' });

    assert.equal(ctx.params.mass, originalMass);
    assert.equal(shot.config.mass, 5);
    assert.ok(Number.isFinite(shot.config.diameter));
    assert.equal(shot.config.wind, 0);
});
