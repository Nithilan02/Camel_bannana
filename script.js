/* ==========================================================
   Camel-Banana Puzzle — Game Logic
   Classes: SoundEngine, Solver, Particle, RingAnimation, Game
   ========================================================== */

// ======================== SOUND ENGINE ========================
class SoundEngine {
    constructor() {
        this.muted = false;
        this.ctx = null;
    }

    init() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('Web Audio not supported');
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    playStep() {
        if (this.muted || !this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(90, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.06);
            gain.gain.setValueAtTime(0.03, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.06);
        } catch (e) { /* silent fail */ }
    }

    playDrop() {
        if (this.muted || !this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(500, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(900, this.ctx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.12);
        } catch (e) { /* silent fail */ }
    }

    playComplete() {
        if (this.muted || !this.ctx) return;
        try {
            [523, 659, 784].forEach((freq, i) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.type = 'sine';
                const t = this.ctx.currentTime + i * 0.15;
                osc.frequency.setValueAtTime(freq, t);
                gain.gain.setValueAtTime(0.1, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
                osc.start(t);
                osc.stop(t + 0.3);
            });
        } catch (e) { /* silent fail */ }
    }
}


// ======================== SOLVER ========================
class Solver {
    /**
     * Compute the optimal step-by-step plan for the camel-banana problem.
     *
     * Algorithm:
     *   Phase with n trips needed (bananas > (n-1)*capacity):
     *     - Cost per km = 2n - 1
     *     - Travel dx = (bananas - (n-1)*capacity) / (2n-1)
     *     - After this segment, bananas = (n-1)*capacity at new position
     *   When n = 1, just walk directly to the market.
     *
     * Each plan step has:
     *   { type: 'forward'|'return', from, to, carry, consumed, drop, phase }
     *
     * For multi-trip phases, the individual forward/return sub-trips are generated
     * so the animation can show the camel going back and forth.
     */
    solve(initialBananas, distance, capacity) {
        const plan = [];
        let bananas = initialBananas;
        let pos = 0;
        let safety = 0;

        while (bananas > 0.001 && pos < distance - 0.001) {
            if (++safety > 10000) break;

            // Clean up floating point
            bananas = Math.round(bananas * 1e8) / 1e8;
            pos = Math.round(pos * 1e8) / 1e8;

            const trips = Math.ceil(bananas / capacity - 1e-9);
            if (trips <= 0) break;

            if (trips === 1) {
                // ---- Final leg: single trip to market ----
                const remaining = distance - pos;
                if (remaining <= 0) break;
                const travelDist = Math.min(remaining, bananas);
                const delivered = bananas - travelDist;

                plan.push({
                    type: 'forward',
                    from: pos,
                    to: pos + travelDist,
                    carry: bananas,
                    consumed: travelDist,
                    drop: Math.max(0, delivered),
                    phase: 1
                });
                break;
            }

            // ---- Multi-trip phase ----
            const costPerKm = 2 * trips - 1;
            const targetBananas = (trips - 1) * capacity;
            let dx = (bananas - targetBananas) / costPerKm;

            // Don't overshoot destination
            if (pos + dx > distance) {
                dx = distance - pos;
            }
            if (dx < 1e-9) break;

            const nextPos = pos + dx;

            // Generate sub-trip steps for this phase segment.
            // The camel shuttles all bananas forward by dx km.
            // Trip pattern: forward, return, forward, return, ..., forward (last has no return)
            //
            // Each forward carry = capacity (or remainder on last trip)
            // Each forward drops = carry - dx  at nextPos
            // Each return consumes dx bananas (camel eats 1/km going back empty,
            //   these bananas come from the SOURCE depot at pos)

            let sourceRemaining = bananas;  // bananas still at pos waiting to be moved

            for (let t = 0; t < trips; t++) {
                const isLast = (t === trips - 1);
                const carry = isLast ? sourceRemaining : capacity;
                const dropped = carry - dx;

                // Forward trip: pos -> nextPos
                plan.push({
                    type: 'forward',
                    from: pos,
                    to: nextPos,
                    carry: carry,
                    consumed: dx,
                    drop: Math.max(0, dropped),
                    phase: trips
                });

                sourceRemaining -= carry;

                // Return trip (except on last trip)
                if (!isLast) {
                    // Camel walks back empty, eating dx bananas from SOURCE depot
                    plan.push({
                        type: 'return',
                        from: nextPos,
                        to: pos,
                        carry: 0,
                        consumed: dx,   // consumed from source depot
                        drop: 0,
                        phase: trips
                    });
                    sourceRemaining -= dx; // return trip eats from source
                }
            }

            pos = nextPos;
            // Bananas at nextPos = sum of all drops = bananas - costPerKm * dx
            bananas = bananas - costPerKm * dx;
            bananas = Math.max(0, bananas);
        }

        return plan;
    }
}


// ======================== PARTICLES ========================
class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 50;
        this.vy = -Math.random() * 50 - 20;
        this.life = 1.0;
        this.color = color || '#ffd700';
        this.size = 2 + Math.random() * 2;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vy += 40 * dt; // gravity
        this.life -= dt * 1.8;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}


// ======================== RING ANIMATION ========================
class RingAnimation {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 5;
        this.life = 1.0;
    }

    update(dt) {
        this.radius += dt * 50;
        this.life -= dt * 2;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        ctx.strokeStyle = `rgba(255, 210, 50, ${this.life * 0.6})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.stroke();
    }
}


// ======================== GAME ========================
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.sound = new SoundEngine();
        this.solver = new Solver();

        this.particles = [];
        this.rings = [];
        this.dpr = window.devicePixelRatio || 1;

        // State
        this.plan = [];
        this.depots = {};         // position -> banana count
        this.currentStepIndex = 0;
        this.stepProgress = 0;
        this.isAnimating = false;
        this.isAuto = false;
        this.speedMultiplier = 5;
        this.camel = { x: 0, load: 0, dir: 1, distTraveled: 0 };
        this.stepTimer = 0;
        this.settings = { b: 3000, d: 1000, c: 1000 };
        this.completed = false;

        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.bindUI();
        this.reset();

        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.loop(t));
    }

    // ---------- UI Binding ----------
    bindUI() {
        const syncSlider = (sliderId, displayId) => {
            const slider = document.getElementById(sliderId);
            const display = document.getElementById(displayId);
            slider.addEventListener('input', () => {
                display.textContent = slider.value;
                this.reset();
            });
        };

        syncSlider('inp-bananas', 'val-bananas');
        syncSlider('inp-dist', 'val-dist');
        syncSlider('inp-cap', 'val-cap');

        // Speed slider
        const speedSlider = document.getElementById('inp-speed');
        const speedDisplay = document.getElementById('val-speed');
        speedSlider.addEventListener('input', () => {
            this.speedMultiplier = parseInt(speedSlider.value);
            speedDisplay.textContent = this.speedMultiplier + 'x';
        });

        // Buttons
        document.getElementById('btn-reset').addEventListener('click', () => this.reset());

        document.getElementById('btn-step').addEventListener('click', () => {
            this.initAudio();
            if (!this.isAnimating && this.currentStepIndex < this.plan.length) {
                this.startStep(this.currentStepIndex);
            }
        });

        document.getElementById('btn-auto').addEventListener('click', () => {
            this.initAudio();
            if (this.currentStepIndex < this.plan.length) {
                this.isAuto = true;
                if (!this.isAnimating) {
                    this.startStep(this.currentStepIndex);
                }
                this.refreshButtons();
            }
        });

        document.getElementById('btn-stop').addEventListener('click', () => {
            this.isAuto = false;
            this.refreshButtons();
        });

        // Mute
        const muteBtn = document.getElementById('btn-mute');
        muteBtn.addEventListener('click', () => {
            this.initAudio();
            this.sound.muted = !this.sound.muted;
            muteBtn.textContent = this.sound.muted ? '🔇 Muted' : '🔊 Sound';
            muteBtn.classList.toggle('muted', this.sound.muted);
        });

        // Help
        document.getElementById('btn-help').addEventListener('click', () => {
            document.getElementById('help-modal').classList.add('show');
        });
        document.getElementById('btn-close-help').addEventListener('click', () => {
            document.getElementById('help-modal').classList.remove('show');
        });
        // Close modal on overlay click
        document.getElementById('help-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                e.currentTarget.classList.remove('show');
            }
        });
    }

    initAudio() {
        this.sound.init();
        this.sound.resume();
    }

    // ---------- Validation ----------
    validate() {
        const { b, d, c } = this.settings;
        const msgEl = document.getElementById('validation-msg');

        if (b <= 0 || d <= 0 || c <= 0) {
            msgEl.textContent = '⚠ All values must be positive.';
            return false;
        }
        if (c > b) {
            // Not strictly invalid — capacity > bananas just means 1 trip
            msgEl.textContent = '';
            return true;
        }
        msgEl.textContent = '';
        return true;
    }

    showError(msg) {
        const toast = document.getElementById('error-toast');
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ---------- Reset ----------
    reset() {
        const b = parseFloat(document.getElementById('inp-bananas').value);
        const d = parseFloat(document.getElementById('inp-dist').value);
        const c = parseFloat(document.getElementById('inp-cap').value);

        this.settings = { b, d, c };

        if (!this.validate()) {
            this.plan = [];
        } else {
            this.plan = this.solver.solve(b, d, c);
        }

        // Init depots: all bananas at position 0
        this.depots = {};
        this.depots['0'] = b;

        this.currentStepIndex = 0;
        this.stepProgress = 0;
        this.isAnimating = false;
        this.isAuto = false;
        this.completed = false;

        this.camel = { x: 0, load: 0, dir: 1, distTraveled: 0 };
        this.particles = [];
        this.rings = [];
        this.stepTimer = 0;

        this.updateStats();
        this.refreshButtons();
    }

    // ---------- Step Execution ----------
    startStep(index) {
        if (index >= this.plan.length) return;

        const step = this.plan[index];
        this.isAnimating = true;
        this.stepProgress = 0;

        // Pick up bananas from the departure depot
        const fromKey = this.depotKey(step.from);
        if (step.carry > 0 && this.depots[fromKey] !== undefined) {
            this.depots[fromKey] -= step.carry;
            if (this.depots[fromKey] < 0.01) delete this.depots[fromKey];
        }

        this.camel.x = step.from;
        this.camel.load = step.carry;
        this.camel.dir = step.to >= step.from ? 1 : -1;

        this.updateStats();
        this.refreshButtons();
    }

    finishStep() {
        const step = this.plan[this.currentStepIndex];
        const dist = Math.abs(step.to - step.from);

        this.camel.x = step.to;
        this.camel.load = 0;
        this.camel.distTraveled += dist;

        // Drop bananas at destination
        if (step.drop > 0.01) {
            const toKey = this.depotKey(step.to);
            this.depots[toKey] = (this.depots[toKey] || 0) + step.drop;

            // Spawn visual effects
            const px = this.getCanvasX(step.to);
            const py = this.canvas.height * 0.72;
            this.spawnDropEffects(px, py, step.drop);
        }

        // For return trips, the camel eats dx bananas walking back.
        // These come from the SOURCE depot (step.to for return = original pos).
        if (step.type === 'return') {
            const sourceKey = this.depotKey(step.to);
            if (this.depots[sourceKey] !== undefined) {
                this.depots[sourceKey] -= step.consumed;
                if (this.depots[sourceKey] < 0.01) delete this.depots[sourceKey];
            }
        }

        this.currentStepIndex++;
        this.updateStats();

        // Check completion
        if (this.currentStepIndex >= this.plan.length) {
            this.isAnimating = false;
            this.isAuto = false;
            this.completed = true;
            this.sound.playComplete();
        } else if (this.isAuto) {
            this.startStep(this.currentStepIndex);
        } else {
            this.isAnimating = false;
        }

        this.refreshButtons();
    }

    // ---------- Helpers ----------
    depotKey(position) {
        return String(Math.round(position * 1000) / 1000);
    }

    getCanvasX(worldX) {
        const padding = 80 * this.dpr;
        const usable = this.canvas.width - 2 * padding;
        return padding + (worldX / this.settings.d) * usable;
    }

    lerp(a, b, t) {
        return a + (b - a) * t;
    }

    easeInOut(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    spawnDropEffects(x, y, count) {
        const n = Math.min(20, Math.floor(count / 20) + 5);
        for (let i = 0; i < n; i++) {
            this.particles.push(new Particle(x, y, '#ffd700'));
        }
        this.rings.push(new RingAnimation(x, y));
        this.sound.playDrop();
    }

    // ---------- Update ----------
    update(dt) {
        if (this.isAnimating && this.currentStepIndex < this.plan.length) {
            const step = this.plan[this.currentStepIndex];
            const dist = Math.abs(step.to - step.from) || 1;

            // Duration scales with distance proportion, modified by speed
            const baseDuration = 0.4 + (dist / this.settings.d) * 1.8;
            const duration = baseDuration / this.speedMultiplier;

            this.stepProgress += dt / duration;

            // Dust particles
            if (Math.random() < 0.35) {
                const px = this.getCanvasX(this.camel.x);
                const py = this.canvas.height * 0.72 + (Math.random() * 8 - 4) * this.dpr;
                this.particles.push(new Particle(px, py, 'rgba(200, 160, 80, 0.7)'));
            }

            // Footstep sound
            this.stepTimer += dt;
            if (this.stepTimer > 0.2 / this.speedMultiplier) {
                this.stepTimer = 0;
                this.sound.playStep();
            }

            if (this.stepProgress >= 1.0) {
                this.stepProgress = 1.0;
                this.finishStep();
            } else {
                const t = this.easeInOut(this.stepProgress);
                this.camel.x = this.lerp(step.from, step.to, t);
                this.camel.load = Math.max(0, step.carry - step.consumed * t);
            }
        }

        // Update effects
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update(dt);
            if (this.particles[i].life <= 0) this.particles.splice(i, 1);
        }
        for (let i = this.rings.length - 1; i >= 0; i--) {
            this.rings[i].update(dt);
            if (this.rings[i].life <= 0) this.rings.splice(i, 1);
        }
    }

    // ---------- Draw ----------
    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        if (w === 0 || h === 0) return;

        // ---- Sky (Day → Sunset → Night) ----
        const prog = Math.min(1.0, Math.max(0, this.camel.x / this.settings.d));

        const skyTop = ctx.createLinearGradient(0, 0, 0, h * 0.55);
        skyTop.addColorStop(0, `rgb(${this.lerp(85, 10, prog)},${this.lerp(180, 12, prog)},${this.lerp(245, 40, prog)})`);
        skyTop.addColorStop(1, `rgb(${this.lerp(250, 55, prog)},${this.lerp(175, 25, prog)},${this.lerp(95, 45, prog)})`);
        ctx.fillStyle = skyTop;
        ctx.fillRect(0, 0, w, h * 0.55);

        // Stars at night
        if (prog > 0.6) {
            const starAlpha = (prog - 0.6) * 2.5;
            ctx.fillStyle = `rgba(255,255,255,${Math.min(1, starAlpha)})`;
            const starSeed = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.15, 0.6, 0.35, 0.9, 0.05, 0.78];
            const starY = [0.05, 0.12, 0.08, 0.18, 0.03, 0.15, 0.2, 0.07, 0.22, 0.1, 0.16, 0.02];
            for (let i = 0; i < starSeed.length; i++) {
                ctx.beginPath();
                ctx.arc(w * starSeed[i], h * starY[i], 1.5 * this.dpr, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // ---- Sun / Moon ----
        const ceX = w * 0.12 + prog * w * 0.76;
        const ceY = h * 0.18 - Math.sin(prog * Math.PI) * h * 0.08;
        ctx.save();
        if (prog < 0.5) {
            const sunAlpha = 1 - prog * 1.8;
            ctx.shadowBlur = 40 * this.dpr;
            ctx.shadowColor = `rgba(255, 200, 50, ${sunAlpha})`;
            ctx.fillStyle = `rgba(255, 230, 80, ${Math.max(0, sunAlpha)})`;
        } else {
            const moonAlpha = (prog - 0.5) * 2;
            ctx.shadowBlur = 25 * this.dpr;
            ctx.shadowColor = `rgba(200, 210, 255, ${moonAlpha * 0.6})`;
            ctx.fillStyle = `rgba(230, 235, 255, ${Math.min(1, moonAlpha)})`;
        }
        ctx.beginPath();
        ctx.arc(ceX, ceY, 28 * this.dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // ---- Sand ----
        const sandGrad = ctx.createLinearGradient(0, h * 0.5, 0, h);
        const sandLight = prog < 0.5;
        sandGrad.addColorStop(0, sandLight ? '#e8bd6e' : '#5a4a38');
        sandGrad.addColorStop(1, sandLight ? '#d4a854' : '#3e3028');
        ctx.fillStyle = sandGrad;
        ctx.fillRect(0, h * 0.5, w, h * 0.5);

        // Dune curve
        ctx.beginPath();
        ctx.moveTo(0, h * 0.52);
        ctx.bezierCurveTo(w * 0.2, h * 0.48, w * 0.4, h * 0.56, w * 0.6, h * 0.51);
        ctx.bezierCurveTo(w * 0.8, h * 0.46, w * 0.9, h * 0.54, w, h * 0.50);
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.fillStyle = sandLight ? '#d9a84d' : '#4d3c2c';
        ctx.fill();

        // ---- Path ----
        const pathY = h * 0.72;
        const pathH = h * 0.28;
        ctx.fillStyle = sandLight ? 'rgba(150, 105, 40, 0.35)' : 'rgba(30, 20, 10, 0.5)';
        ctx.fillRect(0, pathY, w, pathH);

        // Dotted road markers
        ctx.setLineDash([10 * this.dpr, 20 * this.dpr]);
        ctx.strokeStyle = sandLight ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 2 * this.dpr;
        ctx.beginPath();
        ctx.moveTo(0, pathY + pathH / 2);
        ctx.lineTo(w, pathY + pathH / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // ---- Oasis and Market icons ----
        const iconSize = 36 * this.dpr;
        ctx.font = `${iconSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('🌴', this.getCanvasX(0), pathY - 2 * this.dpr);
        ctx.fillText('🏪', this.getCanvasX(this.settings.d), pathY - 2 * this.dpr);

        // Labels
        ctx.font = `bold ${11 * this.dpr}px Inter, sans-serif`;
        ctx.fillStyle = sandLight ? 'rgba(100,70,20,0.7)' : 'rgba(200,180,150,0.6)';
        ctx.fillText('OASIS', this.getCanvasX(0), pathY + pathH - 6 * this.dpr);
        ctx.fillText('MARKET', this.getCanvasX(this.settings.d), pathY + pathH - 6 * this.dpr);

        // ---- Rings ----
        this.rings.forEach(r => r.draw(ctx));

        // ---- Depots ----
        for (const [key, count] of Object.entries(this.depots)) {
            const cnt = Math.round(count);
            if (cnt <= 0) continue;
            const px = this.getCanvasX(parseFloat(key));
            const py = pathY;

            // Banana icon
            ctx.font = `${20 * this.dpr}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('🍌', px, py + 2 * this.dpr);

            // Count badge
            ctx.font = `bold ${12 * this.dpr}px Inter, sans-serif`;
            const label = cnt.toLocaleString();
            const tw = ctx.measureText(label).width;
            const badgeW = tw + 10 * this.dpr;
            const badgeH = 18 * this.dpr;
            const badgeX = px - badgeW / 2;
            const badgeY = py + 6 * this.dpr;

            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4 * this.dpr);
            ctx.fill();

            ctx.fillStyle = '#ffd700';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, px, badgeY + badgeH / 2);
        }

        // ---- Camel ----
        const cx = this.getCanvasX(this.camel.x);
        const cy = pathY - 4 * this.dpr;

        ctx.save();
        ctx.translate(cx, cy);
        if (this.camel.dir < 0) ctx.scale(-1, 1);
        ctx.font = `${34 * this.dpr}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('🐫', 0, 0);
        ctx.restore();

        // Load badge above camel
        const loadDisplay = Math.round(this.camel.load);
        if (loadDisplay > 0) {
            ctx.font = `bold ${12 * this.dpr}px Inter, sans-serif`;
            const txt = loadDisplay.toLocaleString();
            const tw2 = ctx.measureText(txt).width;
            const bw = tw2 + 12 * this.dpr;
            const bh = 20 * this.dpr;

            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.beginPath();
            ctx.roundRect(cx - bw / 2, cy - 50 * this.dpr, bw, bh, 5 * this.dpr);
            ctx.fill();

            // Small triangle pointer
            ctx.beginPath();
            ctx.moveTo(cx - 5 * this.dpr, cy - 30 * this.dpr);
            ctx.lineTo(cx + 5 * this.dpr, cy - 30 * this.dpr);
            ctx.lineTo(cx, cy - 24 * this.dpr);
            ctx.fill();

            ctx.fillStyle = '#ffcc00';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(txt, cx, cy - 40 * this.dpr);
        }

        // ---- Completion message ----
        if (this.completed) {
            const delivered = this.getDelivered();
            ctx.font = `bold ${20 * this.dpr}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const msg = `✅ Delivered ${delivered} bananas!`;
            const mw = ctx.measureText(msg).width;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.beginPath();
            ctx.roundRect(w / 2 - mw / 2 - 20 * this.dpr, h * 0.38 - 18 * this.dpr, mw + 40 * this.dpr, 36 * this.dpr, 10 * this.dpr);
            ctx.fill();

            ctx.fillStyle = '#ffd700';
            ctx.fillText(msg, w / 2, h * 0.38);
        }

        // ---- Particles ----
        this.particles.forEach(p => p.draw(ctx));
    }

    // ---------- Game Loop ----------
    loop(now) {
        let dt = (now - this.lastTime) / 1000;
        if (dt > 0.1) dt = 0.1; // clamp
        this.lastTime = now;

        this.update(dt);
        this.draw();

        requestAnimationFrame((t) => this.loop(t));
    }

    // ---------- Resize ----------
    resize() {
        const container = document.getElementById('canvas-container');
        const rect = container.getBoundingClientRect();
        this.canvas.width = rect.width * this.dpr;
        this.canvas.height = rect.height * this.dpr;
    }

    // ---------- Stats ----------
    getDelivered() {
        const destKey = this.depotKey(this.settings.d);
        return Math.round(this.depots[destKey] || 0);
    }

    updateStats() {
        const delivered = this.getDelivered();
        let desertBananas = 0;
        const destKey = this.depotKey(this.settings.d);
        for (const [key, val] of Object.entries(this.depots)) {
            if (key !== destKey) desertBananas += val;
        }
        if (this.camel.load > 0) desertBananas += this.camel.load;

        document.getElementById('stat-delivered').textContent = delivered.toLocaleString();
        document.getElementById('stat-desert').textContent = Math.round(desertBananas).toLocaleString();

        // Total distance
        let totalDist = this.camel.distTraveled;
        if (this.isAnimating && this.currentStepIndex < this.plan.length) {
            const step = this.plan[this.currentStepIndex];
            totalDist += Math.abs(step.to - step.from) * this.stepProgress;
        }
        document.getElementById('stat-total-dist').textContent = Math.round(totalDist).toLocaleString();

        document.getElementById('stat-step').textContent = this.currentStepIndex;
        document.getElementById('stat-total').textContent = this.plan.length;

        // Phase info
        let phaseText = '—';
        if (this.completed) {
            phaseText = '✅ Complete';
        } else if (this.plan.length > 0 && this.currentStepIndex < this.plan.length) {
            const phase = this.plan[this.currentStepIndex].phase;
            phaseText = phase === 1 ? 'Final leg (1 trip)' : `${phase} trips/phase`;
        }
        document.getElementById('stat-cost').textContent = phaseText;

        // Progress bar
        const pbar = document.getElementById('progress-bar');
        if (this.plan.length > 0) {
            const perc = ((this.currentStepIndex + (this.isAnimating ? this.stepProgress : 0)) / this.plan.length) * 100;
            pbar.style.width = Math.min(100, perc) + '%';
        } else {
            pbar.style.width = '0%';
        }
    }

    // ---------- Button States ----------
    refreshButtons() {
        const done = this.currentStepIndex >= this.plan.length && !this.isAnimating;
        document.getElementById('btn-step').disabled = this.isAnimating || done || this.isAuto;
        document.getElementById('btn-auto').disabled = this.isAuto || done;
        document.getElementById('btn-stop').disabled = !this.isAuto;
    }
}


// ======================== INIT ========================
window.addEventListener('DOMContentLoaded', () => {
    new Game();
});
