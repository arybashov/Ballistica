(function () {
    const fields = [
        'v0', 'angle', 'azimuth', 'h0', 'dt', 'maxTime', 'windX', 'windY', 'windZ',
        'turbulence', 'turbulenceScale', 'densityScale', 'mass', 'diameter',
        'length', 'cgFromNose', 'cpFromNose', 'spinRpm', 'formFactor', 'cdConst'
    ];

    const $ = (id) => document.getElementById(id);
    const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
    const fmt1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
    const fmt2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
    const fmt3 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

    const state = {
        scene: null,
        projectile: null,
        running: false,
        preview: null,
        lastFrame: 0,
        accumulator: 0,
        speedScale: 7,
        targetRange: 15000,
        targetLateral: 0
    };

    function setParamValues(next) {
        Object.assign(params, next);
    }

    function readInputs() {
        const next = {};
        for (const id of fields) {
            next[id] = Number($(id).value);
        }
        next.cdModel = document.querySelector('#cdModelGroup button.active')?.dataset.cdModel || params.cdModel;
        return next;
    }

    function writeInputs() {
        for (const id of fields) {
            $(id).value = params[id];
        }
        $('preset').value = params.preset || 'shell152Of540Like';
        for (const button of document.querySelectorAll('#cdModelGroup button')) {
            button.classList.toggle('active', button.dataset.cdModel === params.cdModel);
        }
        $('targetRange').value = Math.round(state.targetRange);
    }

    function applyPreset(key) {
        const preset = PROJECTILE_PRESETS[key];
        if (!preset) return;
        setParamValues({ preset: key, ...preset.params });
        const forecast = runShot();
        state.targetRange = Math.round(forecast.getHorizontalRange() / 100) * 100;
        writeInputs();
        rebuildPreview();
        resetLive();
    }

    function runShot(overrides = {}) {
        const p = { ...params, ...overrides };
        const shot = new Projectile(p.v0, p.angle, p.h0, p.azimuth, p);
        shot.run(p.maxTime, p.dt);
        return shot;
    }

    function makeVacuumTrail(v0, angleDeg, h0, azimuthDeg, samples = 150) {
        const hit = analyticVacuumImpact(v0, angleDeg, h0);
        const theta = angleDeg * DEG2RAD;
        const az = azimuthDeg * DEG2RAD;
        const vh = v0 * Math.cos(theta);
        const vx = vh * Math.cos(az);
        const vz = vh * Math.sin(az);
        const vy = v0 * Math.sin(theta);
        const trail = [];
        for (let i = 0; i <= samples; i++) {
            const t = hit.time * i / samples;
            trail.push({
                x: vx * t,
                y: Math.max(0, h0 + vy * t - 0.5 * 9.80665 * t * t),
                z: vz * t
            });
        }
        return { hit, trail };
    }

    function rebuildPreview() {
        setParamValues(readInputs());
        state.targetRange = Number($('targetRange').value) || state.targetRange;
        const az = (params.azimuth || 0) * DEG2RAD;
        const targetPoint = {
            x: state.targetRange * Math.cos(az),
            z: state.targetRange * Math.sin(az)
        };
        state.targetLateral = targetPoint.z;

        const dragShot = runShot();
        const vacuum = makeVacuumTrail(params.v0, params.angle, params.h0, params.azimuth);
        state.preview = { dragShot, vacuum };
        state.scene.setTrajectories(dragShot.trail, vacuum.trail, targetPoint);
        state.scene.setProjectileDesign(params);
        state.scene.setWindField(params);
        updateReadouts(dragShot, vacuum.hit);
    }

    function resetLive() {
        setParamValues(readInputs());
        state.projectile = new Projectile(params.v0, params.angle, params.h0, params.azimuth, params);
        state.running = false;
        state.accumulator = 0;
        state.scene.setLiveTrail(state.projectile.trail);
        state.scene.setProjectileDesign(params);
        state.scene.setWindField(params);
        updateRunState();
        updateHud(state.projectile);
        state.scene.setProjectile(state.projectile, state.projectile.flightPathAngle, params.azimuth * DEG2RAD);
    }

    function launch() {
        setParamValues(readInputs());
        state.projectile = new Projectile(params.v0, params.angle, params.h0, params.azimuth, params);
        state.running = true;
        state.accumulator = 0;
        updateRunState();
    }

    function togglePause() {
        if (!state.projectile) resetLive();
        state.running = !state.running;
        updateRunState();
    }

    function updateRunState() {
        const label = $('runState');
        if (state.projectile?.landed) {
            label.textContent = 'Попадание';
            return;
        }
        label.textContent = state.running ? 'Полет' : 'Пауза';
    }

    function updateHud(shot) {
        $('hudRange').textContent = `${fmt.format(shot.getHorizontalRange())} м`;
        $('hudAltitude').textContent = `${fmt.format(Math.max(0, shot.y))} м`;
        $('hudSpeed').textContent = `${fmt.format(shot.getSpeed())} м/с`;
        $('hudMach').textContent = fmt2.format(shot.mach || shot.getSpeed() / atmosphereAt(shot.y).speedOfSound);
        $('hudCd').textContent = fmt3.format(shot.cd || cdFromMach(shot.mach || 0, params.formFactor, params.cdModel, params.cdConst));
        $('hudTime').textContent = `${fmt1.format(shot.t)} с`;
    }

    function updateReadouts(dragShot, vacuumHit) {
        const area = Math.PI * params.diameter * params.diameter / 4;
        const section = params.mass / Math.max(area, 1e-9);
        const dragRange = dragShot.getHorizontalRange();
        const loss = vacuumHit.range > 0 ? (1 - dragRange / vacuumHit.range) * 100 : 0;
        const vacuumNumeric = runShot({ cdModel: 'none' });
        const vacError = vacuumHit.range > 0 ? Math.abs(vacuumNumeric.getHorizontalRange() - vacuumHit.range) / vacuumHit.range * 100 : 0;

        $('metricArea').textContent = `${fmt3.format(area)} м²`;
        $('metricSectional').textContent = `${fmt.format(section)} кг/м²`;
        $('metricMaxQ').textContent = `${fmt1.format(dragShot.maxQ / 1000)} кПа`;
        $('metricEnergy').textContent = `${fmt2.format(dragShot.getKineticEnergy() / 1000000)} МДж`;
        $('metricImpactAngle').textContent = `${fmt1.format(dragShot.impactAngle * RAD2DEG)}°`;
        $('metricLever').textContent = `${fmt3.format(dragShot.config.cpFromNose - dragShot.config.cgFromNose)} м`;
        $('metricStaticMargin').textContent = `${fmt1.format(dragShot.staticMargin * 100)}%`;
        $('metricMoment').textContent = `${fmt1.format(dragShot.aeroMoment)} Нм`;
        $('metricSpinIndex').textContent = fmt2.format(dragShot.stabilityIndex);

        $('verifyDragRange').textContent = `${fmt.format(dragRange)} м`;
        $('verifyVacRange').textContent = `${fmt.format(vacuumHit.range)} м`;
        $('verifyLoss').textContent = `${fmt1.format(loss)}%`;
        $('verifyVacError').textContent = `${fmt3.format(vacError)}%`;
        $('verifyApogee').textContent = `${fmt.format(dragShot.maxHeight)} м`;
        $('verifyNote').textContent = dragShot.landed
            ? `Полет завершен за ${fmt1.format(dragShot.t)} с. Верификация сравнивает RK4 без сопротивления с аналитической вакуумной параболой.`
            : 'Снаряд не достиг земли в заданный лимит времени.';

        renderCdCurve();
    }

    function renderCdCurve() {
        const machs = [0, 0.5, 0.8, 1, 1.2, 1.5, 2, 3];
        $('cdCurveReadout').innerHTML = machs.map((mach) => {
            const cd = cdFromMach(mach, params.formFactor, params.cdModel, params.cdConst);
            return `<span>M ${fmt1.format(mach)}: Cd ${fmt3.format(cd)}</span>`;
        }).join('');
    }

    function findAngleForTarget() {
        setParamValues(readInputs());
        const target = Number($('targetRange').value);
        if (!Number.isFinite(target) || target <= 0) return;

        let best = { angle: params.angle, error: Infinity, shot: null };
        for (let angle = 5; angle <= 75; angle += 0.5) {
            const shot = runShot({ angle });
            const error = Math.abs(shot.getHorizontalRange() - target);
            if (error < best.error) best = { angle, error, shot };
        }

        let lo = Math.max(1, best.angle - 1);
        let hi = Math.min(85, best.angle + 1);
        for (let i = 0; i < 18; i++) {
            const a = lo + (hi - lo) / 3;
            const b = hi - (hi - lo) / 3;
            const ea = Math.abs(runShot({ angle: a }).getHorizontalRange() - target);
            const eb = Math.abs(runShot({ angle: b }).getHorizontalRange() - target);
            if (ea < eb) hi = b;
            else lo = a;
        }

        params.angle = (lo + hi) / 2;
        $('angle').value = fmt1.format(params.angle).replace(',', '.');
        rebuildPreview();
        resetLive();
    }

    function setTargetToPrediction() {
        if (!state.preview) rebuildPreview();
        state.targetRange = Math.round(state.preview.dragShot.getHorizontalRange() / 100) * 100;
        $('targetRange').value = state.targetRange;
        rebuildPreview();
    }

    function animate(now) {
        requestAnimationFrame(animate);
        const dtFrame = Math.min(0.05, (now - (state.lastFrame || now)) / 1000);
        state.lastFrame = now;

        if (state.running && state.projectile && !state.projectile.landed) {
            state.accumulator += dtFrame * state.speedScale;
            const step = Math.max(0.002, params.dt || 0.02);
            let guard = 0;
            while (state.accumulator >= step && guard < 120) {
                state.projectile.step(step);
                state.accumulator -= step;
                guard++;
                if (state.projectile.landed || state.projectile.t >= params.maxTime) {
                    state.running = false;
                    break;
                }
            }
            state.scene.setProjectile(
                state.projectile,
                state.projectile.flightPathAngle,
                Math.atan2(state.projectile.vz, state.projectile.vx)
            );
            state.scene.setLiveTrail(state.projectile.trail);
            updateHud(state.projectile);
            updateRunState();
        }

        state.scene.render();
    }

    function bindTabs() {
        const tabs = [
            { button: $('tabDesigner'), panel: $('designerPanel') },
            { button: $('tabVerify'), panel: $('verifyPanel') }
        ];
        for (const item of tabs) {
            item.button.addEventListener('click', () => {
                for (const tab of tabs) {
                    const active = tab === item;
                    tab.button.classList.toggle('active', active);
                    tab.button.setAttribute('aria-selected', String(active));
                    tab.panel.classList.toggle('active', active);
                }
            });
        }
    }

    function bindEvents() {
        $('preset').addEventListener('change', (event) => applyPreset(event.target.value));
        for (const id of fields) {
            $(id).addEventListener('change', () => {
                rebuildPreview();
                resetLive();
            });
        }
        $('targetRange').addEventListener('change', rebuildPreview);
        $('launchBtn').addEventListener('click', launch);
        $('pauseBtn').addEventListener('click', togglePause);
        $('resetBtn').addEventListener('click', () => {
            rebuildPreview();
            resetLive();
        });
        $('findAngleBtn').addEventListener('click', findAngleForTarget);
        $('snapTargetBtn').addEventListener('click', setTargetToPrediction);

        for (const button of document.querySelectorAll('#cdModelGroup button')) {
            button.addEventListener('click', () => {
                for (const item of document.querySelectorAll('#cdModelGroup button')) item.classList.remove('active');
                button.classList.add('active');
                rebuildPreview();
                resetLive();
            });
        }
        bindTabs();
    }

    function init() {
        if (!window.THREE) {
            $('runState').textContent = 'Нет Three.js';
            return;
        }
        state.scene = new BallisticaScene($('sceneCanvas'));
        const forecast = runShot();
        state.targetRange = Math.round(forecast.getHorizontalRange() / 100) * 100;
        writeInputs();
        bindEvents();
        rebuildPreview();
        resetLive();
        requestAnimationFrame(animate);
    }

    document.addEventListener('DOMContentLoaded', init);
})();
