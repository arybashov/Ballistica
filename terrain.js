// ==========================================
// HEIGHTMAP TERRAIN MANAGER (Gaea PNG)
// ==========================================
// Загружает карту высот из PNG. По умолчанию — плоская земля (0м).
// getHeight(wx, wz) — высота в точке мира (м).
// getHeightData() — метаданные для построения 3D-меша.
// loadHeightmap(file, cb) — загрузить Gaea heightmap PNG.

(function () {
    const HM_SIZE = 2048;          // pixels
    const WORLD = 500;             // meters default
    const MAX_H = 2000;            // max height in world meters

    function sample(dataArr, wx, wz, worldSize) {
        const half = worldSize / 2;
        const fx = Math.max(0, Math.min(HM_SIZE - 2, (wx + half) / worldSize * (HM_SIZE - 1)));
        const fy = Math.max(0, Math.min(HM_SIZE - 2, (wz + half) / worldSize * (HM_SIZE - 1)));
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const a = dataArr[y0 * HM_SIZE + x0];
        const b = dataArr[y0 * HM_SIZE + x0 + 1];
        const c = dataArr[(y0 + 1) * HM_SIZE + x0];
        const d = dataArr[(y0 + 1) * HM_SIZE + x0 + 1];
        return (1 - ty) * ((1 - tx) * a + tx * b) + ty * ((1 - tx) * c + tx * d);
    }

    const TerrainManager = {
        heightData: null,
        hasHeightmap: false,

        getHeight(wx, wz) {
            if (!this.hasHeightmap || !this.heightData) return 0;
            return sample(this.heightData, wx, wz, this._worldSize || WORLD) * (this._maxH || MAX_H);
        },

        getHeightData() {
            return {
                width: HM_SIZE,
                height: HM_SIZE,
                worldSize: this._worldSize || WORLD,
                maxH: this._maxH || MAX_H,
                hasHeightmap: this.hasHeightmap,
            };
        },

        getHeightmapImageData() {
            return this.heightData;
        },

        loadHeightmap(file, callback) {
            const self = this;
            const reader = new FileReader();
            reader.onload = function (e) {
                const img = new Image();
                img.onload = function () {
                    const canvas = document.createElement('canvas');
                    canvas.width = HM_SIZE;
                    canvas.height = HM_SIZE;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, HM_SIZE, HM_SIZE);
                    const px = ctx.getImageData(0, 0, HM_SIZE, HM_SIZE);
                    const data = new Float32Array(HM_SIZE * HM_SIZE);
                    for (let i = 0; i < data.length; i++) {
                        data[i] = px.data[i * 4] / 255;
                    }
                    self.heightData = data;
                    self.hasHeightmap = true;
                    if (callback) callback();
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        },

        reset() {
            this.heightData = null;
            this.hasHeightmap = false;
        },

        setWorldSize(v) {
            // WORLD is module-scoped const, expose via getHeightData
            this._worldSize = Math.max(500, Math.min(50000, Number(v) || 20000));
        },

        setMaxHeight(v) {
            this._maxH = Math.max(100, Math.min(10000, Number(v) || 2000));
        },
    };

    window.TerrainManager = TerrainManager;
})();
