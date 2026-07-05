(function () {
    const LINE_ACTUAL = 0xf0b24f;
    const LINE_VACUUM = 0x76a7ff;
    const TARGET = 0xf25f5c;

    class BallisticaScene {
        constructor(canvas) {
            this.canvas = canvas;
            this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            this.renderer.setClearColor(0x11161b, 1);

            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 3000);
            this.camera.position.set(-120, 72, 122);
            this.camera.lookAt(45, 16, 0);

            this.scale = 0.01;
            this.targetRange = 10000;
            this.targetLateral = 0;
            this.projectileDesign = { length: 0.71, diameter: 0.1524, cgFromNose: 0.34, cpFromNose: 0.43 };
            this.orbit = { yaw: -0.82, pitch: 0.42, distance: 175, target: new THREE.Vector3(42, 14, 0) };
            this.dragState = null;

            this.root = new THREE.Group();
            this.scene.add(this.root);

            this.actualLine = this.makeLine(LINE_ACTUAL, 2.5);
            this.vacuumLine = this.makeLine(LINE_VACUUM, 1.6);
            this.liveLine = this.makeLine(0xffffff, 2.2);
            this.root.add(this.actualLine, this.vacuumLine, this.liveLine);

            this.projectile = this.makeProjectile();
            this.root.add(this.projectile);

            this.targetMarker = this.makeTargetMarker();
            this.root.add(this.targetMarker);

            this.grid = new THREE.GridHelper(220, 22, 0x3e4b54, 0x273139);
            this.grid.position.y = 0;
            this.scene.add(this.grid);

            this.rangeMarks = new THREE.Group();
            this.scene.add(this.rangeMarks);
            this.windField = new THREE.Group();
            this.scene.add(this.windField);

            const hemi = new THREE.HemisphereLight(0xd6edf5, 0x20242a, 2.1);
            const sun = new THREE.DirectionalLight(0xffffff, 2.2);
            sun.position.set(-60, 90, 30);
            this.scene.add(hemi, sun);

            this.bindPointerControls();
            window.addEventListener('resize', () => this.resize());
            this.resize();
        }

        makeLine(color, width) {
            const material = new THREE.LineBasicMaterial({ color, linewidth: width, transparent: true, opacity: 0.95 });
            return new THREE.Line(new THREE.BufferGeometry(), material);
        }

        makeProjectile() {
            const group = new THREE.Group();
            const body = new THREE.Mesh(
                new THREE.CylinderGeometry(1.15, 1.15, 4.2, 24),
                new THREE.MeshStandardMaterial({ color: 0xd7dde0, roughness: 0.48, metalness: 0.25 })
            );
            body.rotation.z = Math.PI / 2;
            const tailCap = new THREE.Mesh(
                new THREE.SphereGeometry(1.15, 20, 12),
                new THREE.MeshStandardMaterial({ color: 0xd7dde0, roughness: 0.48, metalness: 0.25 })
            );
            tailCap.position.x = -2.1;
            const nose = new THREE.Mesh(
                new THREE.ConeGeometry(1.4, 2.1, 24),
                new THREE.MeshStandardMaterial({ color: 0xf0b24f, roughness: 0.42, metalness: 0.2 })
            );
            nose.rotation.z = -Math.PI / 2;
            nose.position.x = 3.15;
            this.cgMarker = new THREE.Mesh(
                new THREE.SphereGeometry(0.32, 16, 10),
                new THREE.MeshBasicMaterial({ color: 0x4cc9a4 })
            );
            this.cpMarker = new THREE.Mesh(
                new THREE.SphereGeometry(0.32, 16, 10),
                new THREE.MeshBasicMaterial({ color: 0x76a7ff })
            );
            group.add(body, tailCap, nose, this.cgMarker, this.cpMarker);
            return group;
        }

        makeTargetMarker() {
            const group = new THREE.Group();
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(3.6, 0.18, 8, 42),
                new THREE.MeshBasicMaterial({ color: TARGET })
            );
            ring.rotation.x = Math.PI / 2;
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.12, 9, 10),
                new THREE.MeshBasicMaterial({ color: TARGET })
            );
            post.position.y = 4.5;
            group.add(ring, post);
            return group;
        }

        bindPointerControls() {
            this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
            this.canvas.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                this.canvas.setPointerCapture(event.pointerId);
                this.dragState = {
                    mode: event.button === 1 || event.button === 2 ? 'pan' : 'orbit',
                    x: event.clientX,
                    y: event.clientY,
                    yaw: this.orbit.yaw,
                    pitch: this.orbit.pitch,
                    target: this.orbit.target.clone()
                };
            });
            this.canvas.addEventListener('pointermove', (event) => {
                if (!this.dragState) return;
                const dx = event.clientX - this.dragState.x;
                const dy = event.clientY - this.dragState.y;

                if (this.dragState.mode === 'pan') {
                    const panScale = this.orbit.distance * 0.0018;
                    const forward = new THREE.Vector3().subVectors(this.orbit.target, this.camera.position).normalize();
                    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
                    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
                    this.orbit.target.copy(this.dragState.target)
                        .addScaledVector(right, -dx * panScale)
                        .addScaledVector(up, dy * panScale);
                } else {
                    this.orbit.yaw = this.dragState.yaw - dx * 0.006;
                    this.orbit.pitch = Math.max(-0.1, Math.min(1.15, this.dragState.pitch + dy * 0.004));
                }
                this.updateCamera();
            });
            this.canvas.addEventListener('pointerup', (event) => {
                if (this.canvas.hasPointerCapture(event.pointerId)) {
                    this.canvas.releasePointerCapture(event.pointerId);
                }
                this.dragState = null;
            });
            this.canvas.addEventListener('pointercancel', () => {
                this.dragState = null;
            });
            this.canvas.addEventListener('wheel', (event) => {
                event.preventDefault();
                this.orbit.distance = Math.max(42, Math.min(520, this.orbit.distance * (1 + event.deltaY * 0.001)));
                this.updateCamera();
            }, { passive: false });
        }

        raycastTerrain(event) {
            if (!this.clickCallback || !this.terrainMesh) return;
            const rect = this.canvas.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            this.raycaster.setFromCamera(mouse, this.camera);
            const hits = this.raycaster.intersectObject(this.terrainMesh);
            if (hits.length > 0) {
                const p = hits[0].point;
                const wx = p.x / this.scale;
                const wz = p.z / this.scale;
                const h = (typeof getTerrainHeight === 'function') ? getTerrainHeight(wx, wz) : 0;
                this.clickCallback(wx, wz, h);
            }
        }

        setOnTerrainClick(cb) {
            this.clickCallback = cb;
        }

        setGunWorld(wx, wz, wy) {
            this.gunWorld = { x: wx, z: wz, y: wy };
            const h = wy != null ? wy : ((typeof getTerrainHeight === 'function') ? getTerrainHeight(wx, wz) : 0);
            this.gunMarker.position.set(wx * this.scale, h * this.scale, wz * this.scale);
            this.gunMarker.scale.setScalar(Math.max(0.7, Math.min(2.2, 0.12 / Math.max(this.scale, 0.001))));
            this.gunMarker.visible = true;
        }

        resize() {
            const width = Math.max(1, this.canvas.clientWidth);
            const height = Math.max(1, this.canvas.clientHeight);
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.updateCamera();
        }

        updateCamera() {
            const { yaw, pitch, distance, target } = this.orbit;
            const cp = Math.cos(pitch);
            this.camera.position.set(
                target.x + Math.sin(yaw) * cp * distance,
                target.y + Math.sin(pitch) * distance,
                target.z + Math.cos(yaw) * cp * distance
            );
            this.camera.lookAt(target);
        }

        metersToScene(point) {
            return new THREE.Vector3(point.x * this.scale, point.y * this.scale, point.z * this.scale);
        }

        setScaleFromTrajectories(actualTrail, vacuumTrail, targetPoint) {
            let extent = Math.max(1000, Math.hypot(targetPoint?.x || 0, targetPoint?.z || 0));
            for (const point of [...actualTrail, ...vacuumTrail]) {
                extent = Math.max(extent, Math.abs(point.x), Math.abs(point.z), point.y * 1.4);
            }
            this.scale = 170 / extent;
            const rangeScene = Math.max(60, extent * this.scale);
            this.grid.scale.setScalar(rangeScene / 110);
            this.orbit.target.set(Math.min(80, (Math.abs(targetPoint?.x || 0) || extent * 0.5) * this.scale * 0.48), 18, 0);
            this.orbit.distance = Math.max(95, Math.min(310, rangeScene * 1.35));
            this.updateCamera();
            this.rebuildRangeMarks(extent);
        }

        rebuildRangeMarks(extentMeters) {
            this.rangeMarks.clear();
            const step = this.pickRangeStep(extentMeters);
            const material = new THREE.LineBasicMaterial({ color: 0x46535d, transparent: true, opacity: 0.8 });
            for (let x = step; x <= extentMeters; x += step) {
                const sx = x * this.scale;
                const geometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(sx, 0.04, -2.2),
                    new THREE.Vector3(sx, 0.04, 2.2)
                ]);
                this.rangeMarks.add(new THREE.Line(geometry, material));
            }
        }

        pickRangeStep(extent) {
            if (extent > 50000) return 10000;
            if (extent > 20000) return 5000;
            if (extent > 9000) return 2000;
            if (extent > 3000) return 1000;
            return 500;
        }

        setTrajectories(actualTrail, vacuumTrail, targetPoint) {
            const target = targetPoint || { x: 0, z: 0 };
            this.targetRange = Math.hypot(target.x || 0, target.z || 0);
            this.targetLateral = target.z || 0;
            this.setScaleFromTrajectories(actualTrail, vacuumTrail, target);
            this.updateLine(this.actualLine, actualTrail);
            this.updateLine(this.vacuumLine, vacuumTrail);
            this.updateLine(this.liveLine, []);
            this.setProjectile(actualTrail[0] || { x: 0, y: 0, z: 0 }, 0);
            this.setTarget(target.x || 0, target.z || 0);
        }

        setProjectileDesign(config) {
            this.projectileDesign = {
                length: Number(config.length) || 0.71,
                diameter: Number(config.diameter) || 0.1524,
                cgFromNose: Number(config.cgFromNose) || 0.34,
                cpFromNose: Number(config.cpFromNose) || 0.43
            };
            this.updateDesignMarkers();
        }

        updateDesignMarkers() {
            if (!this.cgMarker || !this.cpMarker) return;
            const design = this.projectileDesign;
            const length = Math.max(design.diameter * 1.2, design.length);
            const localNoseX = 4.2;
            const localTailX = -3.3;
            const localLength = localNoseX - localTailX;
            const cgT = Math.max(0, Math.min(1, design.cgFromNose / length));
            const cpT = Math.max(0, Math.min(1, design.cpFromNose / length));
            this.cgMarker.position.set(localNoseX - cgT * localLength, 1.45, 0);
            this.cpMarker.position.set(localNoseX - cpT * localLength, -1.45, 0);
        }

        updateLine(line, trail) {
            const points = trail.map((point) => this.metersToScene(point));
            line.geometry.dispose();
            line.geometry = new THREE.BufferGeometry().setFromPoints(points);
        }

        setProjectile(point, flightPathAngleRad, azimuthRad) {
            const scenePoint = this.metersToScene(point);
            this.projectile.position.copy(scenePoint);
            const size = Math.max(0.95, Math.min(2.6, 0.22 / Math.max(this.scale, 0.001)));
            const slenderness = (this.projectileDesign.length || 0.71) / Math.max(this.projectileDesign.diameter || 0.1524, 0.001);
            this.projectile.scale.set(size * Math.max(0.7, Math.min(1.8, slenderness / 4.7)), size, size);
            this.updateDesignMarkers();

            let direction = null;
            if (point.axis && Number.isFinite(point.axis.x) && Number.isFinite(point.axis.y) && Number.isFinite(point.axis.z)) {
                direction = new THREE.Vector3(point.axis.x, point.axis.y, point.axis.z);
            } else if (
                Number.isFinite(point.vx) &&
                Number.isFinite(point.vy) &&
                Number.isFinite(point.vz)
            ) {
                direction = new THREE.Vector3(point.vx, point.vy, point.vz);
            } else {
                const gamma = flightPathAngleRad || 0;
                const azimuth = azimuthRad || 0;
                direction = new THREE.Vector3(
                    Math.cos(gamma) * Math.cos(azimuth),
                    Math.sin(gamma),
                    Math.cos(gamma) * Math.sin(azimuth)
                );
            }

            if (direction.lengthSq() > 1e-9) {
                direction.normalize();
                this.projectile.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);
            }
        }

        setLiveTrail(trail) {
            this.updateLine(this.liveLine, trail);
        }

        setWindField(config = {}) {
            this.windField.clear();
            const windMag = Math.hypot(Number(config.windX) || 0, Number(config.windY) || 0, Number(config.windZ) || 0);
            const turbulence = Number(config.turbulence) || 0;
            if (windMag + turbulence <= 0.01 || typeof airflowVelocityAt !== 'function') return;

            const positions = [];
            const colors = [];
            const grid = [-0.45, -0.15, 0.15, 0.45];
            const extentM = Math.max(2000, this.targetRange || 10000);
            const baseX = extentM * 0.45;
            for (const gx of grid) {
                for (const gz of grid) {
                    const world = {
                        x: Math.max(0, baseX + gx * extentM),
                        y: Math.max(100, extentM * 0.08),
                        z: gz * extentM * 0.35
                    };
                    const air = airflowVelocityAt(world.x, world.y, world.z, 0, config);
                    const start = this.metersToScene(world);
                    const len = Math.hypot(air.x, air.y, air.z);
                    if (len < 0.05) continue;
                    const arrowScale = Math.min(0.18, 0.035 + len * 0.003);
                    const end = new THREE.Vector3(
                        start.x + air.x * arrowScale,
                        start.y + air.y * arrowScale,
                        start.z + air.z * arrowScale
                    );
                    positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
                    const c = Math.min(1, len / 35);
                    colors.push(0.25 + c * 0.75, 0.78, 0.66 - c * 0.35, 0.25 + c * 0.75, 0.78, 0.66 - c * 0.35);
                }
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.78 });
            this.windField.add(new THREE.LineSegments(geometry, material));
        }

        setTarget(rangeMeters, lateralMeters) {
            this.targetMarker.position.set(rangeMeters * this.scale, 0, (lateralMeters || 0) * this.scale);
            const size = Math.max(0.75, Math.min(2.4, 0.12 / Math.max(this.scale, 0.001)));
            this.targetMarker.scale.setScalar(size);
        }

        render() {
            this.renderer.render(this.scene, this.camera);
        }
    }

    window.BallisticaScene = BallisticaScene;
})();
