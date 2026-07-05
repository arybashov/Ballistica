(function(global) {
    'use strict';

    const MISSING = -9999;

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function createEmptyGrid(size) {
        return new Float32Array(size * size).fill(MISSING);
    }

    function parseVertexLine(line) {
        if (line.charCodeAt(0) !== 118 || line.charCodeAt(1) !== 32) return null;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) return null;
        const x = Number(parts[1]);
        const y = Number(parts[2]);
        const z = Number(parts[3]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        return { x, y, z };
    }

    function scanObjVertices(text, onVertex) {
        let start = 0;
        while (start < text.length) {
            let end = text.indexOf('\n', start);
            if (end === -1) end = text.length;
            const line = text.slice(start, end);
            const v = parseVertexLine(line);
            if (v) onVertex(v);
            start = end + 1;
        }
    }

    function getRawBounds(objText) {
        const bounds = {
            minX: Infinity,
            minY: Infinity,
            minZ: Infinity,
            maxX: -Infinity,
            maxY: -Infinity,
            maxZ: -Infinity,
            count: 0
        };

        scanObjVertices(objText, function(v) {
            bounds.minX = Math.min(bounds.minX, v.x);
            bounds.minY = Math.min(bounds.minY, v.y);
            bounds.minZ = Math.min(bounds.minZ, v.z);
            bounds.maxX = Math.max(bounds.maxX, v.x);
            bounds.maxY = Math.max(bounds.maxY, v.y);
            bounds.maxZ = Math.max(bounds.maxZ, v.z);
            bounds.count++;
        });

        if (!bounds.count) throw new Error('OBJ has no vertices');
        return bounds;
    }

    function fillHeightGridHoles(grid, size) {
        for (let pass = 0; pass < 8; pass++) {
            let changed = 0;
            const next = new Float32Array(grid);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const idx = y * size + x;
                    if (grid[idx] !== MISSING) continue;
                    let sum = 0;
                    let count = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (!dx && !dy) continue;
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
                            const v = grid[ny * size + nx];
                            if (v === MISSING) continue;
                            sum += v;
                            count++;
                        }
                    }
                    if (count) {
                        next[idx] = sum / count;
                        changed++;
                    }
                }
            }
            grid.set(next);
            if (!changed) break;
        }

        for (let i = 0; i < grid.length; i++) {
            if (grid[i] === MISSING) grid[i] = 0;
        }
    }

    function createHeightGridFromObjText(objText, options) {
        const opts = options || {};
        const size = opts.gridSize || 256;
        const worldSize = opts.worldSize || 35000;
        const bounds = getRawBounds(objText);
        const rawSizeX = bounds.maxX - bounds.minX;
        const rawSizeZ = bounds.maxZ - bounds.minZ;
        const rawSize = Math.max(rawSizeX, rawSizeZ);
        const scale = worldSize / rawSize;
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerZ = (bounds.minZ + bounds.maxZ) / 2;
        const minX = (bounds.minX - centerX) * scale;
        const minZ = (bounds.minZ - centerZ) * scale;
        const grid = createEmptyGrid(size);

        scanObjVertices(objText, function(v) {
            const wx = (v.x - centerX) * scale;
            const wy = (v.y - bounds.minY) * scale;
            const wz = (v.z - centerZ) * scale;
            const gx = Math.round((wx - minX) / worldSize * (size - 1));
            const gy = Math.round((wz - minZ) / worldSize * (size - 1));
            if (gx < 0 || gx >= size || gy < 0 || gy >= size) return;
            const idx = gy * size + gx;
            if (wy > grid[idx]) grid[idx] = wy;
        });

        fillHeightGridHoles(grid, size);

        return {
            data: grid,
            size,
            worldSize,
            minX,
            minZ,
            maxX: minX + worldSize,
            maxZ: minZ + worldSize,
            source: opts.source || 'obj',
            vertexCount: bounds.count,
            scale
        };
    }

    function sampleHeight(grid, wx, wz) {
        if (!grid || !grid.data) return 0;
        const size = grid.size;
        const fx = clamp((wx - grid.minX) / grid.worldSize * (size - 1), 0, size - 1);
        const fy = clamp((wz - grid.minZ) / grid.worldSize * (size - 1), 0, size - 1);
        const x0 = clamp(Math.floor(fx), 0, size - 2);
        const y0 = clamp(Math.floor(fy), 0, size - 2);
        const tx = fx - x0;
        const ty = fy - y0;
        const a = grid.data[y0 * size + x0];
        const b = grid.data[y0 * size + x0 + 1];
        const c = grid.data[(y0 + 1) * size + x0];
        const d = grid.data[(y0 + 1) * size + x0 + 1];
        return (1 - ty) * ((1 - tx) * a + tx * b) + ty * ((1 - tx) * c + tx * d);
    }

    function contains(grid, wx, wz, margin) {
        if (!grid) return false;
        const m = margin || 0;
        return wx >= grid.minX + m && wx <= grid.maxX - m && wz >= grid.minZ + m && wz <= grid.maxZ - m;
    }

    function pickPoint(grid, rng, margin) {
        const m = margin || 0;
        const x = grid.minX + m + rng() * Math.max(1, grid.worldSize - m * 2);
        const z = grid.minZ + m + rng() * Math.max(1, grid.worldSize - m * 2);
        return { x, y: sampleHeight(grid, x, z), z };
    }

    function pointAtBearing(grid, origin, range, bearingDeg) {
        const rad = bearingDeg * Math.PI / 180;
        const x = origin.x + range * Math.cos(rad);
        const z = origin.z + range * Math.sin(rad);
        return { x, y: sampleHeight(grid, x, z), z };
    }

    async function loadObjHeightGrid(url, options) {
        const opts = options || {};
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to load terrain: ' + response.status + ' ' + url);
        const text = await response.text();
        return createHeightGridFromObjText(text, Object.assign({}, opts, { source: url }));
    }

    global.BallisticaTerrain = {
        createHeightGridFromObjText,
        loadObjHeightGrid,
        sampleHeight,
        contains,
        pickPoint,
        pointAtBearing
    };
})(typeof window !== 'undefined' ? window : globalThis);
