class GaugeWidget extends DashboardWidget {
    static type = 'gauge';
    static displayName = 'Gauge';
    static description = 'Circular gauge with needle';
    static icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
    static defaultSize = { width: 8, height: 4 };

    render() {
        const { style = 'default' } = this.config;

        this.element = document.createElement('div');
        this.element.className = 'widget-content';

        switch (style) {
            case 'semicircle':
                this.renderClassic();
                break;
            case 'arc270':
                this.renderModern();
                break;
            case 'speedometer':
                this.renderSpeedometer();
                break;
            case 'dual':
                this.renderDualScale();
                break;
            default:
                this.renderDefault();
        }

        this.container.appendChild(this.element);
    }

    // === Default style (current design) ===
    renderDefault() {
        const { min = 0, max = 100, unit = '' } = this.config;

        this.element.innerHTML = `
            <svg class="gauge-svg" viewBox="0 0 100 60">
                <!-- Background arc -->
                <path class="gauge-background" d="M 10 50 A 40 40 0 0 1 90 50"/>
                <!-- Sector fill (0 to value) -->
                <path class="gauge-sector-fill" id="gauge-sector-${this.id}" style="display: none; opacity: 0.3;"/>
                <!-- Value arc -->
                <path class="gauge-value-arc" id="gauge-arc-${this.id}" d="M 10 50 A 40 40 0 0 1 90 50"/>
                <!-- Needle -->
                <g class="gauge-needle" id="gauge-needle-${this.id}" style="transform-origin: 50px 50px; transform: rotate(-90deg)">
                    <polygon points="50,15 48,50 52,50"/>
                </g>
                <!-- Center -->
                <circle class="gauge-center" cx="50" cy="50" r="6"/>
                <!-- Value text -->
                <text class="gauge-value-text" x="50" y="42" id="gauge-value-${this.id}">0</text>
                <text class="gauge-unit-text" x="50" y="52">${escapeHtml(unit)}</text>
                <!-- Min/Max labels -->
                <text class="gauge-min-text" x="12" y="58">${min}</text>
                <text class="gauge-max-text" x="88" y="58" text-anchor="end">${max}</text>
            </svg>
        `;

        this.arcEl = this.element.querySelector(`#gauge-arc-${this.id}`);
        this.needleEl = this.element.querySelector(`#gauge-needle-${this.id}`);
        this.valueEl = this.element.querySelector(`#gauge-value-${this.id}`);
        this.sectorEl = this.element.querySelector(`#gauge-sector-${this.id}`);
        this.updateArcColor(0);
    }

    // === Classic style (chrome rim, trading style) ===
    renderClassic() {
        const { min = 0, max = 100, unit = '', zones = [] } = this.config;
        const ticks = this.generateTicks(min, max, 5);

        // Semicircular gauge with value below on dark background
        const cx = 50, cy = 46, r = 41;

        this.element.innerHTML = `
            <svg class="gauge-svg gauge-semicircle" viewBox="0 0 100 72">
                <defs>
                    <!-- Chrome gradient for rim -->
                    <linearGradient id="chrome-${this.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#f5f5f5"/>
                        <stop offset="30%" style="stop-color:#e0e0e0"/>
                        <stop offset="50%" style="stop-color:#c8c8c8"/>
                        <stop offset="70%" style="stop-color:#d5d5d5"/>
                        <stop offset="100%" style="stop-color:#a0a0a0"/>
                    </linearGradient>
                    <!-- Face gradient -->
                    <radialGradient id="face-${this.id}" cx="50%" cy="0%" r="100%">
                        <stop offset="0%" style="stop-color:#fafafa"/>
                        <stop offset="100%" style="stop-color:#e8e8e8"/>
                    </radialGradient>
                </defs>

                <!-- Chrome rim (semicircle only) -->
                <path d="M ${cx - r - 5} ${cy} A ${r + 5} ${r + 5} 0 0 1 ${cx + r + 5} ${cy}"
                      fill="none" stroke="url(#chrome-${this.id})" stroke-width="5"/>
                <path d="M ${cx - r - 5} ${cy} A ${r + 5} ${r + 5} 0 0 1 ${cx + r + 5} ${cy}"
                      fill="none" stroke="#888" stroke-width="0.5"/>

                <!-- Inner face (semicircle) -->
                <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z"
                      fill="url(#face-${this.id})" stroke="#999" stroke-width="0.3"/>

                <!-- Sector fill (0 to value) -->
                <path class="gauge-sector-fill" id="gauge-sector-${this.id}" style="display: none; opacity: 0.3;"/>

                <!-- Color zones arc -->
                ${this.renderClassicZones(zones, min, max)}

                <!-- Tick marks and labels -->
                ${ticks.map(t => this.renderClassicTick(t.angle, t.value, t.major)).join('')}

                <!-- Needle -->
                <g class="gauge-needle-semicircle" id="gauge-needle-${this.id}" style="transform-origin: ${cx}px ${cy}px; transform: rotate(-90deg)">
                    <polygon points="${cx},${cy - r + 6} ${cx - 2},${cy - 3} ${cx + 2},${cy - 3}" fill="#222"/>
                    <polygon points="${cx},${cy - r + 8} ${cx - 1.5},${cy - 4} ${cx + 1.5},${cy - 4}" fill="#c00"/>
                </g>

                <!-- Center cap -->
                <circle cx="${cx}" cy="${cy}" r="5" fill="url(#chrome-${this.id})" stroke="#666" stroke-width="0.5"/>
                <circle cx="${cx}" cy="${cy}" r="3" fill="#333"/>

                <!-- Unit inside gauge (center, below cap) -->
                <text x="${cx}" y="${cy - 8}" fill="#555" text-anchor="middle" font-size="9">${escapeHtml(unit)}</text>

                <!-- Value below gauge (white text on dark widget background) -->
                <text class="gauge-semicircle-value" x="${cx}" y="${cy + 17}" id="gauge-value-${this.id}">0</text>
            </svg>
        `;

        this.needleEl = this.element.querySelector(`#gauge-needle-${this.id}`);
        this.valueEl = this.element.querySelector(`#gauge-value-${this.id}`);
        this.sectorEl = this.element.querySelector(`#gauge-sector-${this.id}`);
    }

    renderClassicZones(zones, min, max) {
        if (!zones || zones.length === 0) return '';

        const cx = 50, cy = 46, r = 34;
        let html = '';

        for (const zone of zones) {
            const startPercent = (zone.from - min) / (max - min);
            const endPercent = (zone.to - min) / (max - min);
            // Position angles for cos/sin: LEFT (180°) to RIGHT (360°) via TOP (270°)
            const startAngle = 180 + (startPercent * 180);
            const endAngle = 180 + (endPercent * 180);

            const startRad = startAngle * Math.PI / 180;
            const endRad = endAngle * Math.PI / 180;

            const x1 = cx + r * Math.cos(startRad);
            const y1 = cy + r * Math.sin(startRad);
            const x2 = cx + r * Math.cos(endRad);
            const y2 = cy + r * Math.sin(endRad);

            // Arc spans from startAngle to endAngle (sweep=1 for upper arc in SVG Y-down)
            const arcSpan = Math.abs(endAngle - startAngle);
            const largeArc = arcSpan > 180 ? 1 : 0;

            html += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}"
                          fill="none" stroke="${zone.color}" stroke-width="4" opacity="0.8"/>`;
        }

        return html;
    }

    renderClassicTick(angle, value, major) {
        const cx = 50, cy = 46;
        const outerR = 36;
        const innerR = major ? 30 : 33;
        const textR = 23;

        // Convert from lower semicircle angles (180→0) to upper semicircle (180→360)
        const upperAngle = 360 - angle;
        const rad = upperAngle * Math.PI / 180;
        const x1 = cx + outerR * Math.cos(rad);
        const y1 = cy + outerR * Math.sin(rad);
        const x2 = cx + innerR * Math.cos(rad);
        const y2 = cy + innerR * Math.sin(rad);
        const tx = cx + textR * Math.cos(rad);
        let ty = cy + textR * Math.sin(rad);

        // Raise extreme labels (0 and max) by 3px so they don't extend beyond gauge background
        if (angle === 180 || angle === 0) {
            ty -= 3;
        }

        let html = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                         stroke="#444" stroke-width="${major ? 1 : 0.5}"/>`;

        if (major) {
            html += `<text x="${tx}" y="${ty}" class="gauge-semicircle-tick" text-anchor="middle" dominant-baseline="middle">${value}</text>`;
        }

        return html;
    }

    // === Modern style (Lada dashboard style) ===
    renderModern() {
        const { min = 0, max = 100, unit = '', zones = [] } = this.config;
        const ticks = this.generateTicks(min, max, 5);

        // Match speedometer outer diameter with thicker bezel
        const cx = 60, cy = 55, r = 51;

        this.element.innerHTML = `
            <svg class="gauge-svg gauge-arc270" viewBox="0 0 120 115">
                <defs>
                    <!-- Chrome rim gradient (matching speedometer) -->
                    <linearGradient id="arc270-chrome-${this.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#505050"/>
                        <stop offset="15%" style="stop-color:#404040"/>
                        <stop offset="50%" style="stop-color:#303030"/>
                        <stop offset="85%" style="stop-color:#404040"/>
                        <stop offset="100%" style="stop-color:#353535"/>
                    </linearGradient>
                    <!-- Glow filter -->
                    <filter id="glow-${this.id}" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="blur"/>
                        <feMerge>
                            <feMergeNode in="blur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                    <!-- Needle gradient -->
                    <linearGradient id="needle-grad-${this.id}" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#ff6b35"/>
                        <stop offset="100%" style="stop-color:#f7931e"/>
                    </linearGradient>
                </defs>

                <!-- Outer chrome bezel (thicker, matching speedometer) -->
                <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="url(#arc270-chrome-${this.id})" stroke="#555" stroke-width="0.5"/>

                <!-- Inner dark ring (matching speedometer) -->
                <circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="#252525"/>

                <!-- Dark background -->
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="#1a1a1a"/>

                <!-- Outer glow ring -->
                <circle cx="${cx}" cy="${cy}" r="${r - 2}" fill="none" stroke="#2a4a5a" stroke-width="2" filter="url(#glow-${this.id})"/>

                <!-- Inner ring -->
                <circle cx="${cx}" cy="${cy}" r="${r - 4}" fill="none" stroke="#1e3a4a" stroke-width="1"/>

                <!-- Sector fill (0 to value) -->
                <path class="gauge-sector-fill" id="gauge-sector-${this.id}" style="display: none; opacity: 0.3;"/>

                <!-- Red zone (if defined) -->
                ${this.renderModernRedZone(zones, min, max)}

                <!-- Tick marks and numbers -->
                ${ticks.map(t => this.renderModernTick(t.angle, t.value, t.major)).join('')}

                <!-- Needle -->
                <g class="gauge-needle-arc270" id="gauge-needle-${this.id}" style="transform-origin: ${cx}px ${cy}px; transform: rotate(-135deg)">
                    <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 10}" stroke="#ff6b35" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="${cx}" cy="${cy}" r="4" fill="#333" stroke="#ff6b35" stroke-width="1"/>
                </g>

                <!-- Center cap -->
                <circle cx="${cx}" cy="${cy}" r="6" fill="#222" stroke="#444" stroke-width="1"/>
                <circle cx="${cx}" cy="${cy}" r="3" fill="#333"/>

                <!-- Unit label (centered) -->
                <text class="gauge-arc270-unit" x="${cx}" y="${cy + 22}">${escapeHtml(unit)}</text>

                <!-- Value display (lower position, inside gauge) -->
                <text class="gauge-arc270-value-small" x="${cx}" y="${cy + 35}" id="gauge-value-${this.id}">0</text>
            </svg>
        `;

        this.needleEl = this.element.querySelector(`#gauge-needle-${this.id}`);
        this.valueEl = this.element.querySelector(`#gauge-value-${this.id}`);
        this.sectorEl = this.element.querySelector(`#gauge-sector-${this.id}`);
    }

    renderModernRedZone(zones, min, max) {
        if (!zones || zones.length === 0) return '';

        const cx = 60, cy = 55, r = 38;
        let html = '';

        // Find red/warning zones (typically high values)
        for (const zone of zones) {
            const startPercent = (zone.from - min) / (max - min);
            const endPercent = (zone.to - min) / (max - min);
            // Position angles for cos/sin: BOTTOM-LEFT (135°) to BOTTOM-RIGHT (45°) via TOP (270°)
            const startAngle = 135 + (startPercent * 270);
            const endAngle = 135 + (endPercent * 270);

            const startRad = startAngle * Math.PI / 180;
            const endRad = endAngle * Math.PI / 180;

            const x1 = cx + r * Math.cos(startRad);
            const y1 = cy + r * Math.sin(startRad);
            const x2 = cx + r * Math.cos(endRad);
            const y2 = cy + r * Math.sin(endRad);

            // Arc spans from startAngle to endAngle (increasing angles with sweep=1)
            const arcSpan = Math.abs(endAngle - startAngle);
            const largeArc = arcSpan > 180 ? 1 : 0;

            html += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}"
                          fill="none" stroke="${zone.color}" stroke-width="4" opacity="0.8"/>`;
        }

        return html;
    }

    renderModernTick(angle, value, major) {
        const cx = 60, cy = 55;
        const outerR = 42;
        const innerR = major ? 34 : 38;
        const textR = 26;

        // Convert from semicircle position angles (180° to 0°) to arc270 (135° to 405°)
        const adjustedAngle = 135 + (180 - angle) / 180 * 270;
        const rad = adjustedAngle * Math.PI / 180;

        const x1 = cx + outerR * Math.cos(rad);
        const y1 = cy + outerR * Math.sin(rad);
        const x2 = cx + innerR * Math.cos(rad);
        const y2 = cy + innerR * Math.sin(rad);
        const tx = cx + textR * Math.cos(rad);
        const ty = cy + textR * Math.sin(rad);

        let html = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                         stroke="${major ? '#888' : '#555'}" stroke-width="${major ? 1.5 : 0.5}"/>`;

        if (major) {
            html += `<text x="${tx}" y="${ty}" class="gauge-arc270-tick" text-anchor="middle" dominant-baseline="middle">${value}</text>`;
        }

        return html;
    }

    // === Speedometer style (realistic automotive gauge) ===
    renderSpeedometer() {
        const { min = 0, max = 4000, unit = 'RPM', zones = [] } = this.config;
        const majorStep = this.calculateMajorStep(min, max);
        const ticks = this.generateSpeedoTicks(min, max, majorStep);

        const cx = 60, cy = 55, r = 48;

        this.element.innerHTML = `
            <svg class="gauge-svg gauge-speedometer" viewBox="0 0 120 115">
                <defs>
                    <!-- Chrome rim gradient -->
                    <linearGradient id="speedo-chrome-${this.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#ffffff"/>
                        <stop offset="15%" style="stop-color:#e8e8e8"/>
                        <stop offset="30%" style="stop-color:#c0c0c0"/>
                        <stop offset="50%" style="stop-color:#a8a8a8"/>
                        <stop offset="70%" style="stop-color:#c0c0c0"/>
                        <stop offset="85%" style="stop-color:#d8d8d8"/>
                        <stop offset="100%" style="stop-color:#909090"/>
                    </linearGradient>

                    <!-- Inner chrome ring -->
                    <linearGradient id="speedo-chrome-inner-${this.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#606060"/>
                        <stop offset="50%" style="stop-color:#404040"/>
                        <stop offset="100%" style="stop-color:#606060"/>
                    </linearGradient>

                    <!-- Face gradient (off-white) -->
                    <radialGradient id="speedo-face-${this.id}" cx="50%" cy="30%" r="70%">
                        <stop offset="0%" style="stop-color:#f8f8f8"/>
                        <stop offset="100%" style="stop-color:#e0e0e0"/>
                    </radialGradient>

                    <!-- Shadow filter -->
                    <filter id="speedo-shadow-${this.id}" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.3"/>
                    </filter>

                    <!-- Needle gradient -->
                    <linearGradient id="speedo-needle-${this.id}" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#cc0000"/>
                        <stop offset="50%" style="stop-color:#ff0000"/>
                        <stop offset="100%" style="stop-color:#cc0000"/>
                    </linearGradient>
                </defs>

                <!-- Outer chrome bezel -->
                <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="url(#speedo-chrome-${this.id})"
                        stroke="#707070" stroke-width="0.5"/>

                <!-- Inner dark ring -->
                <circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="url(#speedo-chrome-inner-${this.id})"/>

                <!-- Main face -->
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#speedo-face-${this.id})"
                        filter="url(#speedo-shadow-${this.id})"/>

                <!-- Sector fill (0 to value) -->
                <path class="gauge-sector-fill" id="gauge-sector-${this.id}" style="display: none; opacity: 0.3;"/>

                <!-- Color zones (danger zone etc) -->
                ${this.renderSpeedoZones(zones, min, max, cx, cy, r - 6)}

                <!-- Tick marks and numbers -->
                ${ticks.map(t => this.renderSpeedoTick(t, cx, cy, r)).join('')}

                <!-- Needle assembly -->
                <g class="gauge-needle-tacho" id="gauge-needle-${this.id}" style="transform-origin: ${cx}px ${cy}px; transform: rotate(-135deg)">
                    <!-- Needle shadow -->
                    <polygon points="${cx},${cy - r + 14} ${cx - 3},${cy + 8} ${cx + 3},${cy + 8}"
                             fill="rgba(0,0,0,0.2)" transform="translate(1, 1)"/>
                    <!-- Needle body -->
                    <polygon points="${cx},${cy - r + 14} ${cx - 2.5},${cy + 6} ${cx + 2.5},${cy + 6}"
                             fill="url(#speedo-needle-${this.id})" stroke="#800000" stroke-width="0.3"/>
                    <!-- Needle highlight -->
                    <line x1="${cx}" y1="${cy - r + 16}" x2="${cx}" y2="${cy - 4}"
                          stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
                </g>

                <!-- Center cap (layered for 3D effect) -->
                <circle cx="${cx}" cy="${cy}" r="10" fill="url(#speedo-chrome-${this.id})"
                        stroke="#505050" stroke-width="0.5"/>
                <circle cx="${cx}" cy="${cy}" r="7" fill="#2a2a2a"/>
                <circle cx="${cx}" cy="${cy}" r="5" fill="#1a1a1a" stroke="#333" stroke-width="0.5"/>
                <circle cx="${cx}" cy="${cy}" r="2" fill="#444"/>

                <!-- Unit label (above digital display) -->
                <text class="speedo-unit" x="${cx}" y="${cy + 21}">${escapeHtml(unit)}</text>

                <!-- Digital display -->
                <rect x="${cx - 21}" y="${cy + 27}" width="42" height="11" rx="2"
                      fill="#2a2a2a" stroke="#1a1a1a" stroke-width="0.5"/>
                <rect x="${cx - 20}" y="${cy + 28}" width="40" height="9" rx="1.5"
                      fill="#1e1e1e"/>
                <text class="speedo-digital" x="${cx}" y="${cy + 35}" id="gauge-digital-${this.id}">0</text>
            </svg>
        `;

        this.needleEl = this.element.querySelector(`#gauge-needle-${this.id}`);
        this.digitalEl = this.element.querySelector(`#gauge-digital-${this.id}`);
        this.sectorEl = this.element.querySelector(`#gauge-sector-${this.id}`);
        // valueEl not used in speedometer - digital display shows the value
    }

    // === Dual Scale style (main value + target indicator) ===
    renderDualScale() {
        const { min = 0, max = 100, unit = '', zones = [], sensor2 = '' } = this.config;
        const hasSensor2 = sensor2 && sensor2.trim() !== '';

        const cx = 60, cy = 62, r = 55;
        const majorStep = this.calculateMajorStep(min, max);
        const ticks = this.generateSpeedoTicks(min, max, majorStep);

        this.element.innerHTML = `
            <svg class="gauge-svg gauge-dual" viewBox="0 0 120 125">
                <defs>
                    <!-- Dark background gradient -->
                    <radialGradient id="dual-bg-${this.id}" cx="50%" cy="30%" r="70%">
                        <stop offset="0%" style="stop-color:#3a3a3a"/>
                        <stop offset="100%" style="stop-color:#1a1a1a"/>
                    </radialGradient>

                    <!-- Chrome bezel gradient -->
                    <linearGradient id="dual-chrome-${this.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#606060"/>
                        <stop offset="15%" style="stop-color:#505050"/>
                        <stop offset="50%" style="stop-color:#404040"/>
                        <stop offset="85%" style="stop-color:#505050"/>
                        <stop offset="100%" style="stop-color:#454545"/>
                    </linearGradient>

                    <!-- Cyan glow filter -->
                    <filter id="dual-glow-${this.id}" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="1.5" result="blur"/>
                        <feMerge>
                            <feMergeNode in="blur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>

                    <!-- Orange glow filter for target -->
                    <filter id="dual-target-glow-${this.id}" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="1" result="blur"/>
                        <feMerge>
                            <feMergeNode in="blur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>

                    <!-- Needle gradient (cyan) -->
                    <linearGradient id="dual-needle-${this.id}" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#00a8cc"/>
                        <stop offset="50%" style="stop-color:#00d4ff"/>
                        <stop offset="100%" style="stop-color:#00a8cc"/>
                    </linearGradient>
                </defs>

                <!-- Outer chrome bezel -->
                <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="url(#dual-chrome-${this.id})"
                        stroke="#303030" stroke-width="0.5"/>

                <!-- Inner ring -->
                <circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="#2a2a2a"/>

                <!-- Main face (dark) -->
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#dual-bg-${this.id})"/>

                <!-- Sector fill (0 to value) -->
                <path class="gauge-sector-fill" id="gauge-sector-${this.id}" style="display: none; opacity: 0.3;"/>

                <!-- Color zones -->
                ${this.renderSpeedoZones(zones, min, max, cx, cy, r - 6)}

                <!-- Scale: tick marks -->
                ${ticks.map(t => this.renderDualOuterTick(t, cx, cy, r)).join('')}

                <!-- Target arc (cyan, from 0 to target value) - updated via JS -->
                <path id="gauge-target-arc-${this.id}" class="dual-target-arc"
                      d="" fill="none" stroke="#00d4ff" stroke-width="2.5" opacity="0.6"
                      filter="url(#dual-target-glow-${this.id})" style="display: none;"/>

                <!-- Target indicator (invisible, used only for angle calculation) -->
                <g class="dual-target-marker" id="gauge-target-${this.id}" style="transform-origin: ${cx}px ${cy}px; transform: rotate(-135deg); display: none;"></g>

                <!-- Needle assembly (cyan) -->
                <g class="gauge-needle-dual" id="gauge-needle-${this.id}" style="transform-origin: ${cx}px ${cy}px; transform: rotate(-135deg)">
                    <!-- Needle glow -->
                    <polygon points="${cx},${cy - r + 14} ${cx - 2.5},${cy + 6} ${cx + 2.5},${cy + 6}"
                             fill="#00d4ff" filter="url(#dual-glow-${this.id})" opacity="0.5"/>
                    <!-- Needle body -->
                    <polygon points="${cx},${cy - r + 14} ${cx - 2},${cy + 5} ${cx + 2},${cy + 5}"
                             fill="url(#dual-needle-${this.id})" stroke="#008899" stroke-width="0.3"/>
                    <!-- Needle highlight -->
                    <line x1="${cx}" y1="${cy - r + 16}" x2="${cx}" y2="${cy - 4}"
                          stroke="rgba(255,255,255,0.4)" stroke-width="0.8"/>
                </g>

                <!-- Center cap (cyan glow) -->
                <circle cx="${cx}" cy="${cy}" r="10" fill="#2a2a2a" stroke="#00d4ff" stroke-width="1"/>
                <circle cx="${cx}" cy="${cy}" r="7" fill="#00d4ff" filter="url(#dual-glow-${this.id})"/>
                <circle cx="${cx}" cy="${cy}" r="5" fill="#1a1a1a"/>
                <circle cx="${cx}" cy="${cy}" r="2" fill="#00d4ff"/>

                <!-- Unit label -->
                <text class="dual-unit" x="${cx}" y="${cy + 21}">${escapeHtml(unit)}</text>

                <!-- Digital display for main value (white digits) -->
                <rect x="${cx - 21}" y="${cy + 27}" width="42" height="11" rx="2"
                      fill="#1a1a1a" stroke="#333" stroke-width="0.5"/>
                <rect x="${cx - 20}" y="${cy + 28}" width="40" height="9" rx="1.5"
                      fill="#0a0a0a"/>
                <text class="dual-digital-white" x="${cx}" y="${cy + 35}" id="gauge-digital-${this.id}">--</text>

                <!-- Target value (small, below digital display) - hidden if no sensor2 -->
                <text class="dual-target-small" x="${cx}" y="${cy + 44}" id="gauge-target-digital-${this.id}"
                      style="${hasSensor2 ? '' : 'display: none;'}">${hasSensor2 ? '--' : ''}</text>
            </svg>
        `;

        this.needleEl = this.element.querySelector(`#gauge-needle-${this.id}`);
        this.digitalEl = this.element.querySelector(`#gauge-digital-${this.id}`);
        this.targetEl = this.element.querySelector(`#gauge-target-${this.id}`);
        this.targetArcEl = this.element.querySelector(`#gauge-target-arc-${this.id}`);
        this.targetDigitalEl = this.element.querySelector(`#gauge-target-digital-${this.id}`);
        this.sectorEl = this.element.querySelector(`#gauge-sector-${this.id}`);
        // Store dimensions for arc calculation
        this.dualParams = { cx, cy, r, arcR: r - 2 };
    }

    renderDualOuterTick(tick, cx, cy, r) {
        const { angle, value, major } = tick;
        const rad = angle * Math.PI / 180;

        // Outer scale: ticks at edge, numbers between ticks and inner dots
        const outerR = r - 4;      // tick outer edge
        const innerR = major ? r - 11 : r - 7;  // tick inner edge
        const textR = r - 19;      // numbers position (between ticks and dots)

        const x1 = cx + outerR * Math.cos(rad);
        const y1 = cy + outerR * Math.sin(rad);
        const x2 = cx + innerR * Math.cos(rad);
        const y2 = cy + innerR * Math.sin(rad);

        let html = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                         stroke="#ccc" stroke-width="${major ? 1.8 : 0.8}"/>`;

        if (major) {
            const tx = cx + textR * Math.cos(rad);
            const ty = cy + textR * Math.sin(rad);
            html += `<text x="${tx}" y="${ty}" class="dual-outer-label"
                          text-anchor="middle" dominant-baseline="middle">${value}</text>`;
        }

        return html;
    }

    calculateMajorStep(min, max) {
        const range = max - min;
        if (range <= 100) return 10;
        if (range <= 500) return 50;
        if (range <= 1000) return 100;
        if (range <= 5000) return 500;
        if (range <= 10000) return 1000;
        return 2000;
    }

    generateSpeedoTicks(min, max, majorStep) {
        const ticks = [];
        const minorStep = majorStep / 5;

        for (let v = min; v <= max; v += minorStep) {
            const isMajor = Math.abs(v % majorStep) < 0.001 || Math.abs(v % majorStep - majorStep) < 0.001;
            const percent = (v - min) / (max - min);
            // 270° arc for positioning with cos/sin (135° to 405°/45°)
            const angle = 135 + (percent * 270);
            ticks.push({ value: Math.round(v), angle, major: isMajor });
        }

        return ticks;
    }

    renderSpeedoTick(tick, cx, cy, r) {
        const { angle, value, major } = tick;
        const rad = angle * Math.PI / 180;

        const outerR = r - 4;
        const innerR = major ? r - 12 : r - 8;
        const textR = r - 24;

        const x1 = cx + outerR * Math.cos(rad);
        const y1 = cy + outerR * Math.sin(rad);
        const x2 = cx + innerR * Math.cos(rad);
        const y2 = cy + innerR * Math.sin(rad);

        let html = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                         stroke="#333" stroke-width="${major ? 1.5 : 0.7}"/>`;

        if (major) {
            const tx = cx + textR * Math.cos(rad);
            const ty = cy + textR * Math.sin(rad);
            html += `<text x="${tx}" y="${ty}" class="speedo-tick-label"
                          text-anchor="middle" dominant-baseline="middle">${value}</text>`;
        }

        return html;
    }

    renderSpeedoZones(zones, min, max, cx, cy, r) {
        if (!zones || zones.length === 0) return '';

        let html = '';
        for (const zone of zones) {
            const startPercent = (zone.from - min) / (max - min);
            const endPercent = (zone.to - min) / (max - min);
            // Position angles for cos/sin (135° to 405°/45°)
            const startAngle = 135 + (startPercent * 270);
            const endAngle = 135 + (endPercent * 270);

            const startRad = startAngle * Math.PI / 180;
            const endRad = endAngle * Math.PI / 180;

            const x1 = cx + r * Math.cos(startRad);
            const y1 = cy + r * Math.sin(startRad);
            const x2 = cx + r * Math.cos(endRad);
            const y2 = cy + r * Math.sin(endRad);

            // Arc spans from startAngle to endAngle (increasing angles with sweep=1)
            const arcSpan = Math.abs(endAngle - startAngle);
            const largeArc = arcSpan > 180 ? 1 : 0;

            html += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}"
                          fill="none" stroke="${zone.color}" stroke-width="6" opacity="0.7"/>`;
        }

        return html;
    }

    // === Shared helpers ===
    generateTicks(min, max, majorCount) {
        const ticks = [];
        const range = max - min;
        const majorStep = range / majorCount;
        const minorPerMajor = 4;

        for (let i = 0; i <= majorCount; i++) {
            const value = min + (i * majorStep);
            const percent = i / majorCount;
            // Position angle for cos/sin: 180° (left) to 0° (right) via 90° (bottom)
            const angle = 180 - (percent * 180);
            ticks.push({ angle, value: Math.round(value), major: true });

            // Minor ticks
            if (i < majorCount) {
                for (let j = 1; j <= minorPerMajor; j++) {
                    const minorPercent = (i + j / (minorPerMajor + 1)) / majorCount;
                    const minorAngle = 180 - (minorPercent * 180);
                    const minorValue = min + (minorPercent * range);
                    ticks.push({ angle: minorAngle, value: Math.round(minorValue), major: false });
                }
            }
        }

        return ticks;
    }

    getColorForValue(value) {
        const { zones = [] } = this.config;

        if (zones.length === 0) {
            return 'var(--accent-blue)';
        }

        for (const zone of zones) {
            if (value >= zone.from && value <= zone.to) {
                return zone.color;
            }
        }

        return 'var(--accent-blue)';
    }

    updateArcColor(value) {
        if (this.arcEl) {
            this.arcEl.style.stroke = this.getColorForValue(value);
        }
    }

    update(value, error = null) {
        super.update(value, error);

        const { min = 0, max = 100, decimals = 1, style = 'default' } = this.config;

        // For speedometer/dual, check digitalEl; for others, check valueEl
        const hasDisplay = (style === 'speedometer' || style === 'dual') ? this.digitalEl : this.valueEl;
        if (!hasDisplay && !this.needleEl) return;

        if (error) {
            if (this.valueEl) this.valueEl.textContent = 'ERR';
            if (this.digitalEl) this.digitalEl.textContent = 'ERR';
            if (this.needleEl) this.needleEl.classList.remove('overrange');
            return;
        }

        const numValue = parseFloat(value) || 0;
        const clampedValue = Math.max(min, Math.min(max, numValue));
        const percent = (clampedValue - min) / (max - min);

        // Detect overrange condition
        const isOverrange = numValue < min || numValue > max;

        // Update value text (always show actual value, not clamped)
        if (this.valueEl) this.valueEl.textContent = numValue.toFixed(decimals);

        // Update needle rotation based on style
        // CSS rotate: 0 = UP, positive = clockwise
        // Position angle (math): 0 = RIGHT, positive = counter-clockwise in SVG (Y down)
        // To point at position P: CSS angle = P - 270
        let angle;
        switch (style) {
            case 'semicircle':
                // 180° arc: LEFT (180°) to RIGHT (360°) via TOP (270°) - UPPER semicircle
                // Position = 180 + percent*180, so CSS = (180 + p*180) - 270 = -90 + p*180
                angle = -90 + (percent * 180);
                break;
            case 'arc270':
                // 270° arc: -135 to +135
                angle = -135 + (percent * 270);
                break;
            case 'speedometer':
                // 270° arc: -135 to +135 (same as arc270)
                angle = -135 + (percent * 270);
                // Update digital display (use decimals config)
                if (this.digitalEl) {
                    this.digitalEl.textContent = numValue.toFixed(decimals);
                }
                break;
            case 'dual':
                // 270° arc: -135 to +135 (same as speedometer)
                angle = -135 + (percent * 270);
                // Update digital display
                if (this.digitalEl) {
                    this.digitalEl.textContent = numValue.toFixed(decimals);
                }
                break;
            default:
                // 180° arc: LEFT (180°) to RIGHT (360°) via TOP (270°) - UPPER semicircle
                // Position = 180 + percent*180, so CSS = (180 + p*180) - 270 = -90 + p*180
                angle = -90 + (percent * 180);
        }

        // Apply needle rotation with CSS variable for animation
        this.needleEl.style.setProperty('--needle-angle', `${angle}deg`);
        this.needleEl.style.transform = `rotate(${angle}deg)`;

        // Toggle overrange shake animation
        if (isOverrange) {
            this.needleEl.classList.add('overrange');
        } else {
            this.needleEl.classList.remove('overrange');
        }

        // Update arc color for default style
        if (style === 'default') {
            this.updateArcColor(numValue);
            if (this.arcEl) {
                const arcLength = Math.PI * 40;
                const dashLength = percent * arcLength;
                this.arcEl.style.strokeDasharray = `${dashLength} ${arcLength}`;
            }
        }

        // Update sector fill
        this.lastValue = numValue;
        this.updateSectorFill(percent);
    }

    // Update target indicator for dual scale gauge (instant, no animation)
    updateSetpoint(value, error = null) {
        if (!this.targetEl) return;

        const { min = 0, max = 100, style = 'default', decimals = 1 } = this.config;

        // Only for dual style
        if (style !== 'dual') return;

        if (error) {
            this.targetEl.style.display = 'none';
            if (this.targetArcEl) this.targetArcEl.style.display = 'none';
            if (this.targetDigitalEl) this.targetDigitalEl.textContent = 'ERR';
            return;
        }

        const numValue = parseFloat(value) || 0;
        const clampedValue = Math.max(min, Math.min(max, numValue));
        const percent = (clampedValue - min) / (max - min);

        // Calculate rotation angle (270° arc: -135° to +135°)
        const angle = -135 + (percent * 270);

        // Set rotation directly without transition (instant move)
        this.targetEl.style.transform = `rotate(${angle}deg)`;
        this.targetEl.style.display = 'block';

        // Update target digital display
        if (this.targetDigitalEl) {
            this.targetDigitalEl.textContent = numValue.toFixed(decimals);
        }

        // Update target arc (from 0/min to target value)
        if (this.targetArcEl && this.dualParams) {
            const { cx, cy, arcR } = this.dualParams;
            const startAngle = -135; // Start at min (0)
            const endAngle = angle;  // End at target

            if (percent > 0.01) {
                const arcPath = this.describeArc(cx, cy, arcR, startAngle, endAngle);
                this.targetArcEl.setAttribute('d', arcPath);
                this.targetArcEl.style.display = 'block';
            } else {
                this.targetArcEl.style.display = 'none';
            }
        }
    }

    // Helper to create SVG arc path
    describeArc(cx, cy, r, startAngle, endAngle) {
        const start = this.polarToCartesian(cx, cy, r, endAngle);
        const end = this.polarToCartesian(cx, cy, r, startAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
        return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
    }

    polarToCartesian(cx, cy, r, angleDeg) {
        const angleRad = (angleDeg - 90) * Math.PI / 180;
        return {
            x: cx + r * Math.cos(angleRad),
            y: cy + r * Math.sin(angleRad)
        };
    }

    // Helper to create SVG sector (pie slice) path
    describeSector(cx, cy, r, startAngle, endAngle) {
        const start = this.polarToCartesian(cx, cy, r, startAngle);
        const end = this.polarToCartesian(cx, cy, r, endAngle);
        const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
        const sweepFlag = endAngle > startAngle ? 1 : 0;
        return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y} Z`;
    }

    // Animate sector fill by reading actual needle position from CSS computed style
    // This ensures perfect sync with CSS transition animation
    animateSectorTo(targetPercent) {
        const { fillSector = false, style = 'default' } = this.config;
        if (!fillSector || !this.sectorEl || !this.needleEl) return;

        // Cancel any running animation
        if (this.sectorAnimationId) {
            cancelAnimationFrame(this.sectorAnimationId);
        }

        // Store target for comparison
        this.targetPercent = targetPercent;
        const startTime = performance.now();
        const maxDuration = 1500; // Safety timeout slightly longer than CSS transition (1.2s)

        const animate = () => {
            // Read actual needle angle from computed transform
            const computedStyle = window.getComputedStyle(this.needleEl);
            const transform = computedStyle.transform;

            let currentPercent = targetPercent;

            if (transform && transform !== 'none') {
                // Parse matrix: matrix(a, b, c, d, e, f)
                const match = transform.match(/matrix\(([^)]+)\)/);
                if (match) {
                    const values = match[1].split(', ').map(parseFloat);
                    const a = values[0];
                    const b = values[1];
                    // Calculate rotation angle in radians, then convert to degrees
                    const angleRad = Math.atan2(b, a);
                    const angleDeg = angleRad * (180 / Math.PI);

                    // Convert angle to percent based on gauge style
                    switch (style) {
                        case 'semicircle':
                            // Range: -90° to +90°, so 180° total
                            currentPercent = (angleDeg + 90) / 180;
                            break;
                        case 'arc270':
                        case 'speedometer':
                        case 'dual':
                            // Range: -135° to +135°, so 270° total
                            currentPercent = (angleDeg + 135) / 270;
                            break;
                        default:
                            // Default: -90° to +90°, so 180° total
                            currentPercent = (angleDeg + 90) / 180;
                            break;
                    }
                }
            }

            currentPercent = Math.max(0, Math.min(1, currentPercent));
            this.updateSectorPath(currentPercent);
            this.displayedPercent = currentPercent;

            // Continue animating until needle stops (close to target or timeout)
            const elapsed = performance.now() - startTime;
            if (Math.abs(currentPercent - this.targetPercent) > 0.002 && elapsed < maxDuration) {
                this.sectorAnimationId = requestAnimationFrame(animate);
            }
        };

        this.sectorAnimationId = requestAnimationFrame(animate);
    }

    // Update sector path for given percent (called during animation)
    updateSectorPath(percent) {
        if (!this.sectorEl) return;

        if (percent <= 0.001) {
            this.sectorEl.style.display = 'none';
            return;
        }

        this.sectorEl.style.display = 'block';

        const { style = 'default' } = this.config;
        let path = '';

        switch (style) {
            case 'semicircle': {
                const cx = 50, cy = 46, r = 34;
                const startAngle = -90;
                const endAngle = -90 + (percent * 180);
                path = this.describeSector(cx, cy, r, startAngle, endAngle);
                break;
            }
            case 'arc270':
            case 'speedometer': {
                const cx = 60, cy = 55, r = 44;
                const startAngle = -135;
                const endAngle = -135 + (percent * 270);
                path = this.describeSector(cx, cy, r, startAngle, endAngle);
                break;
            }
            case 'dual': {
                const cx = 60, cy = 62, r = 44;
                const startAngle = -135;
                const endAngle = -135 + (percent * 270);
                path = this.describeSector(cx, cy, r, startAngle, endAngle);
                break;
            }
            default: {
                const cx = 50, cy = 50, r = 35;
                const startAngle = -90;
                const endAngle = -90 + (percent * 180);
                path = this.describeSector(cx, cy, r, startAngle, endAngle);
                break;
            }
        }

        this.sectorEl.setAttribute('d', path);
        this.sectorEl.style.fill = this.getColorForValue(this.lastValue || 0);
    }

    // Update sector fill (starts animation to target percent)
    updateSectorFill(percent) {
        const { fillSector = false } = this.config;
        if (!fillSector) {
            if (this.sectorEl) this.sectorEl.style.display = 'none';
            return;
        }

        // Start animated transition to new value
        this.animateSectorTo(percent);
    }

    static getConfigForm(config = {}) {
        const zones = config.zones || [];
        return `
            <div class="widget-config-field">
                <label>Sensor</label>
                <input type="text" class="widget-input" name="sensor"
                       value="${escapeHtml(config.sensor || '')}" placeholder="Type to search..." autocomplete="off">
            </div>
            <div class="dual-scale-fields" style="display: ${config.style === 'dual' ? 'block' : 'none'};">
                <div class="widget-config-field">
                    <label>Target Sensor</label>
                    <input type="text" class="widget-input" name="sensor2"
                           value="${escapeHtml(config.sensor2 || '')}" placeholder="Target/setpoint sensor..." autocomplete="off">
                </div>
            </div>
            <div class="widget-config-field">
                <label>Label</label>
                <input type="text" class="widget-input" name="label"
                       value="${escapeHtml(config.label || '')}" placeholder="Display label">
            </div>
            <div class="widget-config-field">
                <label>Style</label>
                <select class="widget-select" name="style" onchange="toggleDualScaleFields(this)">
                    <option value="default" ${!config.style || config.style === 'default' ? 'selected' : ''}>Default</option>
                    <option value="semicircle" ${config.style === 'semicircle' ? 'selected' : ''}>Semicircle White</option>
                    <option value="arc270" ${config.style === 'arc270' ? 'selected' : ''}>Arc 270° Black</option>
                    <option value="speedometer" ${config.style === 'speedometer' ? 'selected' : ''}>Speedometer White</option>
                    <option value="dual" ${config.style === 'dual' ? 'selected' : ''}>Dual Scale</option>
                </select>
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Min</label>
                    <input type="number" class="widget-input" name="min"
                           value="${config.min ?? 0}">
                </div>
                <div class="widget-config-field">
                    <label>Max</label>
                    <input type="number" class="widget-input" name="max"
                           value="${config.max ?? 100}">
                </div>
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Unit</label>
                    <input type="text" class="widget-input" name="unit"
                           value="${escapeHtml(config.unit || '')}" placeholder="°C, %, etc.">
                </div>
                <div class="widget-config-field">
                    <label>Decimals</label>
                    <input type="number" class="widget-input" name="decimals"
                           value="${config.decimals ?? 1}" min="0" max="4">
                </div>
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label class="widget-toggle">
                        <input type="checkbox" name="fillSector" ${config.fillSector ? 'checked' : ''}>
                        <span class="widget-toggle-track"><span class="widget-toggle-thumb"></span></span>
                        <span class="widget-toggle-label">Fill sector (0 to value)</span>
                    </label>
                </div>
            </div>
            <div class="widget-config-field">
                <div class="zones-editor">
                    <div class="zones-header">
                        <label>Color Zones</label>
                        <button type="button" class="zones-add-btn" onclick="addZoneField(this)">+ Add Zone</button>
                    </div>
                    <div class="zones-list" id="zones-list">
                        ${zones.map((z, i) => `
                            <div class="zone-item">
                                <input type="color" class="zone-color" name="zone-color-${i}" value="${z.color || '#22c55e'}">
                                <div class="zone-inputs">
                                    <input type="number" class="zone-input" name="zone-from-${i}" value="${z.from ?? 0}" placeholder="From">
                                    <span class="zone-separator">→</span>
                                    <input type="number" class="zone-input" name="zone-to-${i}" value="${z.to ?? 100}" placeholder="To">
                                </div>
                                <button type="button" class="zone-remove-btn" onclick="removeZoneField(this)">×</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    static parseConfigForm(form) {
        const zones = [];
        const zoneItems = form.querySelectorAll('.zone-item');
        zoneItems.forEach((item) => {
            // Find elements by class/type inside item (index-independent)
            const color = item.querySelector('.zone-color')?.value;
            const inputs = item.querySelectorAll('.zone-input');
            const from = parseFloat(inputs[0]?.value);
            const to = parseFloat(inputs[1]?.value);
            if (color && !isNaN(from) && !isNaN(to)) {
                zones.push({ from, to, color });
            }
        });

        const style = form.querySelector('[name="style"]')?.value || 'default';
        const result = {
            sensor: form.querySelector('[name="sensor"]')?.value || '',
            label: form.querySelector('[name="label"]')?.value || '',
            style,
            min: parseFloat(form.querySelector('[name="min"]')?.value) || 0,
            max: parseFloat(form.querySelector('[name="max"]')?.value) || 100,
            unit: form.querySelector('[name="unit"]')?.value || '',
            decimals: parseInt(form.querySelector('[name="decimals"]')?.value) || 1,
            fillSector: form.querySelector('[name="fillSector"]')?.checked || false,
            zones
        };

        // Dual scale fields (target sensor uses same min/max as main)
        if (style === 'dual') {
            result.sensor2 = form.querySelector('[name="sensor2"]')?.value || '';
        }

        return result;
    }
}

// ============================================================================
// Level Widget (CSS + SVG)
// ============================================================================

class LevelWidget extends DashboardWidget {
    static type = 'level';
    static displayName = 'Level';
    static description = 'Tank level indicator';
    static icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="2" width="12" height="20" rx="2"/><rect x="8" y="10" width="8" height="10" fill="currentColor" opacity="0.3"/></svg>';
    static defaultSize = { width: 8, height: 8 };

    render() {
        const { orientation = 'vertical', unit = '%' } = this.config;
        const isVertical = orientation === 'vertical';

        this.element = document.createElement('div');
        this.element.className = 'widget-content';
        this.element.innerHTML = `
            <div class="level-container">
                <div class="level-bar-${isVertical ? 'vertical' : 'horizontal'}">
                    <div class="level-fill-${isVertical ? 'vertical' : 'horizontal'}" id="level-fill-${this.id}"></div>
                    <span class="level-text" id="level-text-${this.id}">--%</span>
                </div>
            </div>
        `;
        this.container.appendChild(this.element);

        this.fillEl = this.element.querySelector(`#level-fill-${this.id}`);
        this.textEl = this.element.querySelector(`#level-text-${this.id}`);
    }

    getColorForValue(value) {
        const { zones = [] } = this.config;

        if (zones.length === 0) {
            return 'var(--accent-blue)';
        }

        for (const zone of zones) {
            if (value >= zone.from && value <= zone.to) {
                return zone.color;
            }
        }

        return 'var(--accent-blue)';
    }

    update(value, error = null) {
        super.update(value, error);

        if (!this.fillEl || !this.textEl) return;

        if (error) {
            this.textEl.textContent = 'ERR';
            return;
        }

        const { min = 0, max = 100, orientation = 'vertical', unit = '%', decimals = 0 } = this.config;
        const numValue = parseFloat(value) || 0;
        const percent = Math.max(0, Math.min(100, ((numValue - min) / (max - min)) * 100));

        const isVertical = orientation === 'vertical';
        if (isVertical) {
            this.fillEl.style.height = `${percent}%`;
        } else {
            this.fillEl.style.width = `${percent}%`;
        }

        this.fillEl.style.backgroundColor = this.getColorForValue(numValue);
        this.textEl.textContent = `${numValue.toFixed(decimals)}${unit}`;
    }

    static getConfigForm(config = {}) {
        const zones = config.zones || [];
        return `
            <div class="widget-config-field">
                <label>Sensor</label>
                <input type="text" class="widget-input" name="sensor"
                       value="${escapeHtml(config.sensor || '')}" placeholder="Type to search..." autocomplete="off">
            </div>
            <div class="widget-config-field">
                <label>Label</label>
                <input type="text" class="widget-input" name="label"
                       value="${escapeHtml(config.label || '')}" placeholder="Display label">
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Min</label>
                    <input type="number" class="widget-input" name="min"
                           value="${config.min ?? 0}">
                </div>
                <div class="widget-config-field">
                    <label>Max</label>
                    <input type="number" class="widget-input" name="max"
                           value="${config.max ?? 100}">
                </div>
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Orientation</label>
                    <select class="widget-select" name="orientation">
                        <option value="vertical" ${config.orientation !== 'horizontal' ? 'selected' : ''}>Vertical</option>
                        <option value="horizontal" ${config.orientation === 'horizontal' ? 'selected' : ''}>Horizontal</option>
                    </select>
                </div>
                <div class="widget-config-field">
                    <label>Unit</label>
                    <input type="text" class="widget-input" name="unit"
                           value="${escapeHtml(config.unit || '%')}" placeholder="%">
                </div>
            </div>
            <div class="widget-config-field">
                <div class="zones-editor">
                    <div class="zones-header">
                        <label>Color Zones</label>
                        <button type="button" class="zones-add-btn" onclick="addZoneField(this)">+ Add Zone</button>
                    </div>
                    <div class="zones-list" id="zones-list">
                        ${zones.map((z, i) => `
                            <div class="zone-item">
                                <input type="color" class="zone-color" name="zone-color-${i}" value="${z.color || '#3b82f6'}">
                                <div class="zone-inputs">
                                    <input type="number" class="zone-input" name="zone-from-${i}" value="${z.from ?? 0}" placeholder="From">
                                    <span class="zone-separator">→</span>
                                    <input type="number" class="zone-input" name="zone-to-${i}" value="${z.to ?? 100}" placeholder="To">
                                </div>
                                <button type="button" class="zone-remove-btn" onclick="removeZoneField(this)">×</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    static parseConfigForm(form) {
        const zones = [];
        const zoneItems = form.querySelectorAll('.zone-item');
        zoneItems.forEach((item) => {
            // Find elements by class/type inside item (index-independent)
            const color = item.querySelector('.zone-color')?.value;
            const inputs = item.querySelectorAll('.zone-input');
            const from = parseFloat(inputs[0]?.value);
            const to = parseFloat(inputs[1]?.value);
            if (color && !isNaN(from) && !isNaN(to)) {
                zones.push({ from, to, color });
            }
        });

        return {
            sensor: form.querySelector('[name="sensor"]')?.value || '',
            label: form.querySelector('[name="label"]')?.value || '',
            min: parseFloat(form.querySelector('[name="min"]')?.value) || 0,
            max: parseFloat(form.querySelector('[name="max"]')?.value) || 100,
            orientation: form.querySelector('[name="orientation"]')?.value || 'vertical',
            unit: form.querySelector('[name="unit"]')?.value || '%',
            zones
        };
    }
}

// ============================================================================
// LED Widget (CSS)
// ============================================================================

class LedWidget extends DashboardWidget {
    static type = 'led';
    static displayName = 'LED';
    static description = 'On/Off indicator';
    static icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
    static defaultSize = { width: 4, height: 4 };

    render() {
        this.element = document.createElement('div');
        this.element.className = 'widget-content';
        this.element.innerHTML = `
            <div class="led-indicator" id="led-${this.id}"></div>
        `;
        this.container.appendChild(this.element);

        this.ledEl = this.element.querySelector(`#led-${this.id}`);
        this.updateLed(false, false);
    }

    updateLed(isOn, isError) {
        if (!this.ledEl) return;

        const { onColor = '#22c55e', offColor = '#6b7280', errorColor = '#ef4444', blinkOnError = true } = this.config;

        this.ledEl.classList.remove('led-on', 'led-blink');

        if (isError) {
            this.ledEl.style.backgroundColor = errorColor;
            this.ledEl.classList.add('led-on');
            if (blinkOnError) {
                this.ledEl.classList.add('led-blink');
            }
        } else if (isOn) {
            this.ledEl.style.backgroundColor = onColor;
            this.ledEl.style.color = onColor;
            this.ledEl.classList.add('led-on');
        } else {
            this.ledEl.style.backgroundColor = offColor;
            this.ledEl.style.color = offColor;
        }
    }

    update(value, error = null) {
        super.update(value, error);

        const { threshold = 0 } = this.config;
        const numValue = parseFloat(value) || 0;
        const isOn = numValue > threshold;

        this.updateLed(isOn, !!error);
    }

    static getConfigForm(config = {}) {
        return `
            <div class="widget-config-field">
                <label>Sensor</label>
                <input type="text" class="widget-input" name="sensor"
                       value="${escapeHtml(config.sensor || '')}" placeholder="Type to search..." autocomplete="off">
            </div>
            <div class="widget-config-field">
                <label>Label</label>
                <input type="text" class="widget-input" name="label"
                       value="${escapeHtml(config.label || '')}" placeholder="Display label">
            </div>
            <div class="widget-config-field">
                <label>Threshold (value > threshold = ON)</label>
                <input type="number" class="widget-input" name="threshold"
                       value="${config.threshold ?? 0}">
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>ON Color</label>
                    <input type="color" class="widget-input" name="onColor"
                           value="${config.onColor || '#22c55e'}" style="height: 38px; padding: 4px;">
                </div>
                <div class="widget-config-field">
                    <label>OFF Color</label>
                    <input type="color" class="widget-input" name="offColor"
                           value="${config.offColor || '#6b7280'}" style="height: 38px; padding: 4px;">
                </div>
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Error Color</label>
                    <input type="color" class="widget-input" name="errorColor"
                           value="${config.errorColor || '#ef4444'}" style="height: 38px; padding: 4px;">
                </div>
                <div class="widget-config-field">
                    <label style="display: flex; align-items: center; gap: 8px; margin-top: 24px;">
                        <input type="checkbox" name="blinkOnError" ${config.blinkOnError !== false ? 'checked' : ''}>
                        Blink on error
                    </label>
                </div>
            </div>
        `;
    }

    static parseConfigForm(form) {
        return {
            sensor: form.querySelector('[name="sensor"]')?.value || '',
            label: form.querySelector('[name="label"]')?.value || '',
            threshold: parseFloat(form.querySelector('[name="threshold"]')?.value) || 0,
            onColor: form.querySelector('[name="onColor"]')?.value || '#22c55e',
            offColor: form.querySelector('[name="offColor"]')?.value || '#6b7280',
            errorColor: form.querySelector('[name="errorColor"]')?.value || '#ef4444',
            blinkOnError: form.querySelector('[name="blinkOnError"]')?.checked !== false
        };
    }
}

// ============================================================================
// Label Widget (static text)
// ============================================================================

class LabelWidget {
    static type = 'label';
    static displayName = 'Label';
    static description = 'Static text label or header';
    static icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><text x="12" y="16" text-anchor="middle" font-size="14" fill="currentColor">Aa</text></svg>';
    static defaultSize = { width: 8, height: 2 };

    constructor(id, config, container) {
        this.id = id;
        this.config = config || {};
        this.container = container;
    }

    render() {
        const {
            text = 'Label',
            fontSize = 'medium',
            color = '#d8dce2',
            align = 'center',
            border = false,
            borderColor = '#4b5563',
            borderWidth = 1,
            borderRadius = 4,
            backgroundColor = 'transparent'
        } = this.config;

        // Font size map
        const fontSizeMap = {
            'small': '14px',
            'medium': '18px',
            'large': '24px',
            'xlarge': '32px'
        };

        // Border styles
        const borderStyle = border
            ? `border: ${borderWidth}px solid ${borderColor}; border-radius: ${borderRadius}px; background: ${backgroundColor};`
            : '';

        this.element = document.createElement('div');
        this.element.className = 'widget-content label-widget';
        this.element.innerHTML = `
            <div class="label-text" id="label-${this.id}"
                 style="font-size: ${fontSizeMap[fontSize] || fontSize};
                        color: ${color};
                        text-align: ${align};
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        justify-content: ${align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'};
                        height: 100%;
                        padding: ${border ? '4px 12px' : '0 8px'};
                        ${borderStyle}">
                ${escapeHtml(text)}
            </div>
        `;
        this.container.appendChild(this.element);
        this.labelEl = this.element.querySelector(`#label-${this.id}`);
    }

    // Label doesn't need sensor updates, but we need the method for compatibility
    update(value, error = null) {
        // No-op - label is static
    }

    // Update text dynamically if needed
    setText(text) {
        if (this.labelEl) {
            this.labelEl.textContent = text;
        }
    }

    static getConfigForm(config = {}) {
        return `
            <div class="widget-config-field">
                <label>Text</label>
                <input type="text" class="widget-input" name="text"
                       value="${escapeHtml(config.text || '')}" placeholder="Label text">
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Font Size</label>
                    <select class="widget-select" name="fontSize">
                        <option value="small" ${config.fontSize === 'small' ? 'selected' : ''}>Small (14px)</option>
                        <option value="medium" ${config.fontSize === 'medium' || !config.fontSize ? 'selected' : ''}>Medium (18px)</option>
                        <option value="large" ${config.fontSize === 'large' ? 'selected' : ''}>Large (24px)</option>
                        <option value="xlarge" ${config.fontSize === 'xlarge' ? 'selected' : ''}>X-Large (32px)</option>
                    </select>
                </div>
                <div class="widget-config-field">
                    <label>Alignment</label>
                    <select class="widget-select" name="align">
                        <option value="left" ${config.align === 'left' ? 'selected' : ''}>Left</option>
                        <option value="center" ${config.align === 'center' || !config.align ? 'selected' : ''}>Center</option>
                        <option value="right" ${config.align === 'right' ? 'selected' : ''}>Right</option>
                    </select>
                </div>
                <div class="widget-config-field">
                    <label>Text Color</label>
                    <input type="color" class="widget-input" name="color"
                           value="${config.color || '#d8dce2'}">
                </div>
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label class="widget-checkbox-label">
                        <input type="checkbox" name="border" ${config.border ? 'checked' : ''}>
                        <span>Show border (nameplate)</span>
                    </label>
                </div>
            </div>
            <div class="widget-config-row label-border-options" style="${config.border ? '' : 'display: none;'}">
                <div class="widget-config-field">
                    <label>Border Color</label>
                    <input type="color" class="widget-input" name="borderColor"
                           value="${config.borderColor || '#4b5563'}">
                </div>
                <div class="widget-config-field">
                    <label>Border Width</label>
                    <input type="number" class="widget-input" name="borderWidth"
                           value="${config.borderWidth || 1}" min="1" max="5">
                </div>
                <div class="widget-config-field">
                    <label>Border Radius</label>
                    <input type="number" class="widget-input" name="borderRadius"
                           value="${config.borderRadius || 4}" min="0" max="20">
                </div>
                <div class="widget-config-field">
                    <label>Background</label>
                    <input type="color" class="widget-input" name="backgroundColor"
                           value="${config.backgroundColor || '#1f2937'}">
                </div>
            </div>
        `;
    }

    static initConfigHandlers(form, config = {}) {
        const borderCheckbox = form.querySelector('[name="border"]');
        const borderOptions = form.querySelector('.label-border-options');

        borderCheckbox?.addEventListener('change', () => {
            if (borderOptions) {
                borderOptions.style.display = borderCheckbox.checked ? '' : 'none';
            }
        });
    }

    static parseConfigForm(form) {
        return {
            text: form.querySelector('[name="text"]')?.value || 'Label',
            fontSize: form.querySelector('[name="fontSize"]')?.value || 'medium',
            align: form.querySelector('[name="align"]')?.value || 'center',
            color: form.querySelector('[name="color"]')?.value || '#d8dce2',
            border: form.querySelector('[name="border"]')?.checked || false,
            borderColor: form.querySelector('[name="borderColor"]')?.value || '#4b5563',
            borderWidth: parseInt(form.querySelector('[name="borderWidth"]')?.value) || 1,
            borderRadius: parseInt(form.querySelector('[name="borderRadius"]')?.value) || 4,
            backgroundColor: form.querySelector('[name="backgroundColor"]')?.value || '#1f2937'
        };
    }
}

// ============================================================================
// Divider Widget (visual separator)
// ============================================================================

class DividerWidget {
    static type = 'divider';
    static displayName = 'Divider';
    static description = 'Horizontal or vertical separator line';
    static icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="12" x2="20" y2="12"/></svg>';
    static defaultSize = { width: 12, height: 1 };

    constructor(id, config, container) {
        this.id = id;
        this.config = config || {};
        this.container = container;
    }

    render() {
        const {
            orientation = 'horizontal',
            color = '#4b5563',
            thickness = 1,
            style = 'solid',
            margin = 8
        } = this.config;

        const isHorizontal = orientation === 'horizontal';

        this.element = document.createElement('div');
        this.element.className = 'widget-content divider-widget';
        this.element.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            padding: ${isHorizontal ? `${margin}px 0` : `0 ${margin}px`};
        `;

        const line = document.createElement('div');
        line.className = 'divider-line';
        line.style.cssText = isHorizontal
            ? `width: 100%; height: ${thickness}px; border-top: ${thickness}px ${style} ${color};`
            : `height: 100%; width: ${thickness}px; border-left: ${thickness}px ${style} ${color};`;

        this.element.appendChild(line);
        this.container.appendChild(this.element);
    }

    // Divider doesn't need updates
    update(value, error = null) {}

    static getConfigForm(config = {}) {
        return `
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Orientation</label>
                    <select class="widget-select" name="orientation">
                        <option value="horizontal" ${config.orientation !== 'vertical' ? 'selected' : ''}>Horizontal</option>
                        <option value="vertical" ${config.orientation === 'vertical' ? 'selected' : ''}>Vertical</option>
                    </select>
                </div>
                <div class="widget-config-field">
                    <label>Style</label>
                    <select class="widget-select" name="style">
                        <option value="solid" ${config.style !== 'dashed' && config.style !== 'dotted' ? 'selected' : ''}>Solid</option>
                        <option value="dashed" ${config.style === 'dashed' ? 'selected' : ''}>Dashed</option>
                        <option value="dotted" ${config.style === 'dotted' ? 'selected' : ''}>Dotted</option>
                    </select>
                </div>
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Thickness (px)</label>
                    <input type="number" class="widget-input" name="thickness"
                           value="${config.thickness || 1}" min="1" max="10">
                </div>
                <div class="widget-config-field">
                    <label>Margin (px)</label>
                    <input type="number" class="widget-input" name="margin"
                           value="${config.margin || 8}" min="0" max="50">
                </div>
                <div class="widget-config-field">
                    <label>Color</label>
                    <input type="color" class="widget-input" name="color"
                           value="${config.color || '#4b5563'}">
                </div>
            </div>
        `;
    }

    static parseConfigForm(form) {
        return {
            orientation: form.querySelector('[name="orientation"]')?.value || 'horizontal',
            style: form.querySelector('[name="style"]')?.value || 'solid',
            thickness: parseInt(form.querySelector('[name="thickness"]')?.value) || 1,
            margin: parseInt(form.querySelector('[name="margin"]')?.value) || 8,
            color: form.querySelector('[name="color"]')?.value || '#4b5563'
        };
    }
}

// ============================================================================
// StatusBar Widget (multiple status indicators)
// ============================================================================

class StatusBarWidget {
    static type = 'statusbar';
    static displayName = 'Status Bar';
    static description = 'Multiple status indicators in a row';
    static icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="3" fill="#22c55e"/><circle cx="12" cy="12" r="3" fill="#ef4444"/><circle cx="19" cy="12" r="3" fill="#6b7280"/></svg>';
    static defaultSize = { width: 12, height: 3 };

    constructor(id, config, container) {
        this.id = id;
        this.config = config || {};
        this.container = container;
        this.indicators = new Map();
    }

    render() {
        const { items = [], layout = 'horizontal' } = this.config;

        this.element = document.createElement('div');
        this.element.className = 'widget-content statusbar-widget';
        this.element.style.cssText = `
            display: flex;
            flex-direction: ${layout === 'vertical' ? 'column' : 'row'};
            align-items: center;
            justify-content: space-around;
            gap: 12px;
            padding: 8px 16px;
            height: 100%;
        `;

        items.forEach((item, idx) => {
            const indicator = this.createIndicator(item, idx);
            this.element.appendChild(indicator);
        });

        this.container.appendChild(this.element);
    }

    createIndicator(item, idx) {
        const { label = `Status ${idx + 1}`, onColor = '#22c55e', offColor = '#6b7280' } = item;

        const el = document.createElement('div');
        el.className = 'statusbar-indicator';
        el.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
        `;

        const led = document.createElement('div');
        led.className = 'statusbar-led';
        led.style.cssText = `
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: ${offColor};
            box-shadow: 0 0 4px ${offColor};
            transition: all 0.3s ease;
        `;

        const labelEl = document.createElement('div');
        labelEl.className = 'statusbar-label';
        labelEl.style.cssText = `
            font-size: 11px;
            color: #9ca3af;
            text-align: center;
            white-space: nowrap;
        `;
        labelEl.textContent = label;

        el.appendChild(led);
        el.appendChild(labelEl);

        this.indicators.set(idx, { element: el, led, item });

        return el;
    }

    // Update specific indicator by index
    updateIndicator(idx, value, error = null) {
        const indicator = this.indicators.get(idx);
        if (!indicator) return;

        const { item, led } = indicator;
        const { threshold = 0.5, onColor = '#22c55e', offColor = '#6b7280', errorColor = '#ef4444' } = item;

        if (error) {
            led.style.background = errorColor;
            led.style.boxShadow = `0 0 8px ${errorColor}`;
        } else {
            const isOn = value > threshold;
            const color = isOn ? onColor : offColor;
            led.style.background = color;
            led.style.boxShadow = isOn ? `0 0 8px ${color}` : `0 0 4px ${color}`;
        }
    }

    // Main update - expects object with sensor values by name
    update(values, error = null) {
        if (typeof values === 'object' && values !== null) {
            const { items = [] } = this.config;
            items.forEach((item, idx) => {
                if (item.sensor && values[item.sensor] !== undefined) {
                    this.updateIndicator(idx, values[item.sensor], error);
                }
            });
        }
    }

    // Update by sensor name (called from SSE handler)
    updateBySensor(sensorName, value, error = null) {
        const { items = [] } = this.config;
        items.forEach((item, idx) => {
            if (item.sensor === sensorName) {
                this.updateIndicator(idx, value, error);
            }
        });
    }

    static getConfigForm(config = {}) {
        const items = config.items || [{ label: 'Status 1', sensor: '', threshold: 0.5, onColor: '#22c55e', offColor: '#6b7280' }];

        const itemsHtml = items.map((item, idx) => `
            <div class="statusbar-item-config" data-idx="${idx}">
                <div class="widget-config-row">
                    <div class="widget-config-field" style="flex: 1;">
                        <label>Label</label>
                        <input type="text" class="widget-input" name="item-label-${idx}"
                               value="${escapeHtml(item.label || '')}" placeholder="Status name">
                    </div>
                    <div class="widget-config-field" style="flex: 2;">
                        <label>Sensor</label>
                        <input type="text" class="widget-input sensor-autocomplete" name="item-sensor-${idx}"
                               value="${escapeHtml(item.sensor || '')}" placeholder="Sensor name">
                    </div>
                </div>
                <div class="widget-config-row">
                    <div class="widget-config-field">
                        <label>Threshold</label>
                        <input type="number" class="widget-input" name="item-threshold-${idx}"
                               value="${item.threshold ?? 0.5}" step="0.1">
                    </div>
                    <div class="widget-config-field">
                        <label>On Color</label>
                        <input type="color" class="widget-input" name="item-onColor-${idx}"
                               value="${item.onColor || '#22c55e'}">
                    </div>
                    <div class="widget-config-field">
                        <label>Off Color</label>
                        <input type="color" class="widget-input" name="item-offColor-${idx}"
                               value="${item.offColor || '#6b7280'}">
                    </div>
                    <button type="button" class="widget-btn-small remove-statusbar-item" data-idx="${idx}" style="align-self: flex-end;">×</button>
                </div>
            </div>
        `).join('');

        return `
            <div class="widget-config-field">
                <label>Layout</label>
                <select class="widget-select" name="layout">
                    <option value="horizontal" ${config.layout !== 'vertical' ? 'selected' : ''}>Horizontal</option>
                    <option value="vertical" ${config.layout === 'vertical' ? 'selected' : ''}>Vertical</option>
                </select>
            </div>
            <div class="widget-config-field">
                <label>Indicators</label>
                <div id="statusbar-items-container">
                    ${itemsHtml}
                </div>
                <button type="button" class="widget-btn" id="add-statusbar-item" style="margin-top: 8px;">
                    + Add Indicator
                </button>
            </div>
        `;
    }

    static initConfigHandlers(form, config = {}) {
        const container = form.querySelector('#statusbar-items-container');
        const addBtn = form.querySelector('#add-statusbar-item');
        let itemCount = (config.items || []).length || 1;

        // Add new indicator
        addBtn?.addEventListener('click', () => {
            const idx = itemCount++;
            const itemHtml = `
                <div class="statusbar-item-config" data-idx="${idx}">
                    <div class="widget-config-row">
                        <div class="widget-config-field" style="flex: 1;">
                            <label>Label</label>
                            <input type="text" class="widget-input" name="item-label-${idx}"
                                   value="" placeholder="Status name">
                        </div>
                        <div class="widget-config-field" style="flex: 2;">
                            <label>Sensor</label>
                            <input type="text" class="widget-input sensor-autocomplete" name="item-sensor-${idx}"
                                   value="" placeholder="Sensor name">
                        </div>
                    </div>
                    <div class="widget-config-row">
                        <div class="widget-config-field">
                            <label>Threshold</label>
                            <input type="number" class="widget-input" name="item-threshold-${idx}"
                                   value="0.5" step="0.1">
                        </div>
                        <div class="widget-config-field">
                            <label>On Color</label>
                            <input type="color" class="widget-input" name="item-onColor-${idx}"
                                   value="#22c55e">
                        </div>
                        <div class="widget-config-field">
                            <label>Off Color</label>
                            <input type="color" class="widget-input" name="item-offColor-${idx}"
                                   value="#6b7280">
                        </div>
                        <button type="button" class="widget-btn-small remove-statusbar-item" data-idx="${idx}" style="align-self: flex-end;">×</button>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', itemHtml);

            // Setup autocomplete for new sensor input
            const newInput = container.querySelector(`[name="item-sensor-${idx}"]`);
            if (newInput && typeof setupSensorAutocomplete === 'function') {
                setupSensorAutocomplete(newInput);
            }
        });

        // Remove indicator
        container?.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-statusbar-item')) {
                const item = e.target.closest('.statusbar-item-config');
                if (item && container.querySelectorAll('.statusbar-item-config').length > 1) {
                    item.remove();
                }
            }
        });

        // Setup autocomplete for existing sensor inputs
        form.querySelectorAll('.sensor-autocomplete').forEach(input => {
            if (typeof setupSensorAutocomplete === 'function') {
                setupSensorAutocomplete(input);
            }
        });
    }

    static parseConfigForm(form) {
        const items = [];
        const itemElements = form.querySelectorAll('.statusbar-item-config');

        itemElements.forEach(el => {
            const idx = el.dataset.idx;
            items.push({
                label: form.querySelector(`[name="item-label-${idx}"]`)?.value || '',
                sensor: form.querySelector(`[name="item-sensor-${idx}"]`)?.value || '',
                threshold: parseFloat(form.querySelector(`[name="item-threshold-${idx}"]`)?.value) || 0.5,
                onColor: form.querySelector(`[name="item-onColor-${idx}"]`)?.value || '#22c55e',
                offColor: form.querySelector(`[name="item-offColor-${idx}"]`)?.value || '#6b7280'
            });
        });

        return {
            layout: form.querySelector('[name="layout"]')?.value || 'horizontal',
            items
        };
    }

    // Get list of sensors this widget uses (for SSE subscription)
    getSensors() {
        const { items = [] } = this.config;
        return items.map(item => item.sensor).filter(s => s);
    }
}

// ============================================================================
// BarGraph Widget (compare multiple values)
// ============================================================================

class BarGraphWidget {
    static type = 'bargraph';
    static displayName = 'Bar Graph';
    static description = 'Compare multiple sensor values';
    static icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="14" width="4" height="6" fill="currentColor" opacity="0.7"/><rect x="10" y="8" width="4" height="12" fill="currentColor" opacity="0.5"/><rect x="16" y="4" width="4" height="16" fill="currentColor" opacity="0.3"/></svg>';
    static defaultSize = { width: 10, height: 6 };

    constructor(id, config, container) {
        this.id = id;
        this.config = config || {};
        this.container = container;
        this.bars = new Map();
    }

    render() {
        const { orientation = 'vertical', showValues = true, showLabels = true } = this.config;
        const items = this.config.items || [];

        this.element = document.createElement('div');
        this.element.className = 'widget-content bargraph-widget';
        this.element.style.cssText = `
            display: flex;
            flex-direction: ${orientation === 'horizontal' ? 'column' : 'row'};
            align-items: stretch;
            justify-content: space-around;
            gap: 8px;
            padding: 12px;
            height: 100%;
        `;

        items.forEach((item, idx) => {
            const bar = this.createBar(item, idx, orientation, showValues, showLabels);
            this.element.appendChild(bar);
        });

        this.container.appendChild(this.element);
    }

    createBar(item, idx, orientation, showValues, showLabels) {
        const { label = `Bar ${idx + 1}`, color = '#3b82f6', min = 0, max = 100 } = item;
        const isVertical = orientation === 'vertical';

        const barContainer = document.createElement('div');
        barContainer.className = 'bargraph-bar-container';
        barContainer.style.cssText = `
            display: flex;
            flex-direction: ${isVertical ? 'column' : 'row'};
            align-items: center;
            flex: 1;
            gap: 4px;
        `;

        // Label at top/left
        if (showLabels) {
            const labelEl = document.createElement('div');
            labelEl.className = 'bargraph-label';
            labelEl.style.cssText = `
                font-size: 11px;
                color: #9ca3af;
                text-align: center;
                white-space: nowrap;
                ${isVertical ? '' : 'min-width: 50px;'}
            `;
            labelEl.textContent = label;
            barContainer.appendChild(labelEl);
        }

        // Bar track
        const track = document.createElement('div');
        track.className = 'bargraph-track';
        track.style.cssText = `
            ${isVertical ? 'width: 100%; height: 100%;' : 'flex: 1; height: 24px;'}
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
            position: relative;
            overflow: hidden;
            ${isVertical ? 'display: flex; flex-direction: column-reverse;' : ''}
        `;

        // Bar fill
        const fill = document.createElement('div');
        fill.className = 'bargraph-fill';
        fill.style.cssText = `
            background: ${color};
            border-radius: 4px;
            transition: all 0.3s ease;
            ${isVertical ? 'width: 100%; height: 0%;' : 'height: 100%; width: 0%;'}
        `;
        track.appendChild(fill);

        barContainer.appendChild(track);

        // Value at bottom/right
        if (showValues) {
            const valueEl = document.createElement('div');
            valueEl.className = 'bargraph-value';
            valueEl.style.cssText = `
                font-size: 12px;
                font-weight: 500;
                color: #d8dce2;
                text-align: center;
                min-width: 40px;
            `;
            valueEl.textContent = '—';
            barContainer.appendChild(valueEl);
        }

        this.bars.set(idx, { container: barContainer, fill, valueEl: barContainer.querySelector('.bargraph-value'), item });

        return barContainer;
    }

    // Update specific bar by index
    updateBar(idx, value) {
        const bar = this.bars.get(idx);
        if (!bar) return;

        const { item, fill, valueEl } = bar;
        const { min = 0, max = 100, unit = '', decimals = 0 } = item;
        const orientation = this.config.orientation || 'vertical';
        const isVertical = orientation === 'vertical';

        // Calculate percentage
        const range = max - min;
        const percent = range > 0 ? Math.max(0, Math.min(100, ((value - min) / range) * 100)) : 0;

        // Update fill
        if (isVertical) {
            fill.style.height = `${percent}%`;
        } else {
            fill.style.width = `${percent}%`;
        }

        // Update value text
        if (valueEl) {
            const displayValue = typeof decimals === 'number' ? value.toFixed(decimals) : value;
            valueEl.textContent = unit ? `${displayValue} ${unit}` : displayValue;
        }
    }

    // Main update - expects object with sensor values by name
    update(values, error = null) {
        if (typeof values === 'object' && values !== null) {
            const { items = [] } = this.config;
            items.forEach((item, idx) => {
                if (item.sensor && values[item.sensor] !== undefined) {
                    this.updateBar(idx, values[item.sensor]);
                }
            });
        }
    }

    // Update by sensor name (called from SSE handler)
    updateBySensor(sensorName, value, error = null) {
        const { items = [] } = this.config;
        items.forEach((item, idx) => {
            if (item.sensor === sensorName) {
                this.updateBar(idx, value);
            }
        });
    }

    static getConfigForm(config = {}) {
        const items = config.items || [{ label: 'Bar 1', sensor: '', min: 0, max: 100, color: '#3b82f6' }];

        const itemsHtml = items.map((item, idx) => `
            <div class="bargraph-item-config" data-idx="${idx}">
                <div class="widget-config-row">
                    <div class="widget-config-field" style="flex: 1;">
                        <label>Label</label>
                        <input type="text" class="widget-input" name="bar-label-${idx}"
                               value="${escapeHtml(item.label || '')}" placeholder="Bar name">
                    </div>
                    <div class="widget-config-field" style="flex: 2;">
                        <label>Sensor</label>
                        <input type="text" class="widget-input sensor-autocomplete" name="bar-sensor-${idx}"
                               value="${escapeHtml(item.sensor || '')}" placeholder="Sensor name">
                    </div>
                </div>
                <div class="widget-config-row">
                    <div class="widget-config-field">
                        <label>Min</label>
                        <input type="number" class="widget-input" name="bar-min-${idx}"
                               value="${item.min ?? 0}">
                    </div>
                    <div class="widget-config-field">
                        <label>Max</label>
                        <input type="number" class="widget-input" name="bar-max-${idx}"
                               value="${item.max ?? 100}">
                    </div>
                    <div class="widget-config-field">
                        <label>Unit</label>
                        <input type="text" class="widget-input" name="bar-unit-${idx}"
                               value="${escapeHtml(item.unit || '')}" placeholder="kW">
                    </div>
                    <div class="widget-config-field">
                        <label>Color</label>
                        <input type="color" class="widget-input" name="bar-color-${idx}"
                               value="${item.color || '#3b82f6'}">
                    </div>
                    <button type="button" class="widget-btn-small remove-bargraph-item" data-idx="${idx}" style="align-self: flex-end;">×</button>
                </div>
            </div>
        `).join('');

        return `
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Orientation</label>
                    <select class="widget-select" name="orientation">
                        <option value="vertical" ${config.orientation !== 'horizontal' ? 'selected' : ''}>Vertical</option>
                        <option value="horizontal" ${config.orientation === 'horizontal' ? 'selected' : ''}>Horizontal</option>
                    </select>
                </div>
                <div class="widget-config-field">
                    <label class="widget-checkbox-label">
                        <input type="checkbox" name="showValues" ${config.showValues !== false ? 'checked' : ''}>
                        <span>Show values</span>
                    </label>
                </div>
                <div class="widget-config-field">
                    <label class="widget-checkbox-label">
                        <input type="checkbox" name="showLabels" ${config.showLabels !== false ? 'checked' : ''}>
                        <span>Show labels</span>
                    </label>
                </div>
            </div>
            <div class="widget-config-field">
                <label>Bars</label>
                <div id="bargraph-items-container">
                    ${itemsHtml}
                </div>
                <button type="button" class="widget-btn" id="add-bargraph-item" style="margin-top: 8px;">
                    + Add Bar
                </button>
            </div>
        `;
    }

    static initConfigHandlers(form, config = {}) {
        const container = form.querySelector('#bargraph-items-container');
        const addBtn = form.querySelector('#add-bargraph-item');
        let itemCount = (config.items || []).length || 1;

        // Add new bar
        addBtn?.addEventListener('click', () => {
            const idx = itemCount++;
            const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];
            const color = colors[idx % colors.length];

            const itemHtml = `
                <div class="bargraph-item-config" data-idx="${idx}">
                    <div class="widget-config-row">
                        <div class="widget-config-field" style="flex: 1;">
                            <label>Label</label>
                            <input type="text" class="widget-input" name="bar-label-${idx}"
                                   value="" placeholder="Bar name">
                        </div>
                        <div class="widget-config-field" style="flex: 2;">
                            <label>Sensor</label>
                            <input type="text" class="widget-input sensor-autocomplete" name="bar-sensor-${idx}"
                                   value="" placeholder="Sensor name">
                        </div>
                    </div>
                    <div class="widget-config-row">
                        <div class="widget-config-field">
                            <label>Min</label>
                            <input type="number" class="widget-input" name="bar-min-${idx}" value="0">
                        </div>
                        <div class="widget-config-field">
                            <label>Max</label>
                            <input type="number" class="widget-input" name="bar-max-${idx}" value="100">
                        </div>
                        <div class="widget-config-field">
                            <label>Unit</label>
                            <input type="text" class="widget-input" name="bar-unit-${idx}" placeholder="kW">
                        </div>
                        <div class="widget-config-field">
                            <label>Color</label>
                            <input type="color" class="widget-input" name="bar-color-${idx}" value="${color}">
                        </div>
                        <button type="button" class="widget-btn-small remove-bargraph-item" data-idx="${idx}" style="align-self: flex-end;">×</button>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', itemHtml);

            // Setup autocomplete for new sensor input
            const newInput = container.querySelector(`[name="bar-sensor-${idx}"]`);
            if (newInput && typeof setupSensorAutocomplete === 'function') {
                setupSensorAutocomplete(newInput);
            }
        });

        // Remove bar
        container?.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-bargraph-item')) {
                const item = e.target.closest('.bargraph-item-config');
                if (item && container.querySelectorAll('.bargraph-item-config').length > 1) {
                    item.remove();
                }
            }
        });

        // Setup autocomplete for existing sensor inputs
        form.querySelectorAll('.sensor-autocomplete').forEach(input => {
            if (typeof setupSensorAutocomplete === 'function') {
                setupSensorAutocomplete(input);
            }
        });
    }

    static parseConfigForm(form) {
        const items = [];
        const itemElements = form.querySelectorAll('.bargraph-item-config');

        itemElements.forEach(el => {
            const idx = el.dataset.idx;
            items.push({
                label: form.querySelector(`[name="bar-label-${idx}"]`)?.value || '',
                sensor: form.querySelector(`[name="bar-sensor-${idx}"]`)?.value || '',
                min: parseFloat(form.querySelector(`[name="bar-min-${idx}"]`)?.value) || 0,
                max: parseFloat(form.querySelector(`[name="bar-max-${idx}"]`)?.value) || 100,
                unit: form.querySelector(`[name="bar-unit-${idx}"]`)?.value || '',
                color: form.querySelector(`[name="bar-color-${idx}"]`)?.value || '#3b82f6'
            });
        });

        return {
            orientation: form.querySelector('[name="orientation"]')?.value || 'vertical',
            showValues: form.querySelector('[name="showValues"]')?.checked !== false,
            showLabels: form.querySelector('[name="showLabels"]')?.checked !== false,
            items
        };
    }

    // Get list of sensors this widget uses (for SSE subscription)
    getSensors() {
        const { items = [] } = this.config;
        return items.map(item => item.sensor).filter(s => s);
    }
}

// ============================================================================
// Digital Widget (CSS)
// ============================================================================

class DigitalWidget extends DashboardWidget {
    static type = 'digital';
    static displayName = 'Digital';
    static description = 'Digital numeric display';
    static icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><text x="12" y="15" text-anchor="middle" font-size="8" fill="currentColor">123</text></svg>';
    static defaultSize = { width: 8, height: 4 };

    // 7-segment digit patterns: segments a,b,c,d,e,f,g (top, top-right, bottom-right, bottom, bottom-left, top-left, middle)
    static SEGMENT_PATTERNS = {
        '0': [1,1,1,1,1,1,0],
        '1': [0,1,1,0,0,0,0],
        '2': [1,1,0,1,1,0,1],
        '3': [1,1,1,1,0,0,1],
        '4': [0,1,1,0,0,1,1],
        '5': [1,0,1,1,0,1,1],
        '6': [1,0,1,1,1,1,1],
        '7': [1,1,1,0,0,0,0],
        '8': [1,1,1,1,1,1,1],
        '9': [1,1,1,1,0,1,1],
        '-': [0,0,0,0,0,0,1],
        ' ': [0,0,0,0,0,0,0],
        'E': [1,0,0,1,1,1,1],
        'R': [0,0,0,0,1,0,1],
        '.': 'dot',
        ':': 'colon'
    };

    render() {
        const { style = 'default' } = this.config;

        this.element = document.createElement('div');
        this.element.className = 'widget-content';

        switch (style) {
            case 'lcd':
                this.renderLCD();
                break;
            case 'led':
                this.renderLED();
                break;
            default:
                this.renderDefault();
        }

        this.container.appendChild(this.element);
    }

    renderDefault() {
        this.element.innerHTML = `
            <div class="digital-display" id="digital-${this.id}">----</div>
        `;
        this.displayEl = this.element.querySelector(`#digital-${this.id}`);
        const { color = '#22c55e' } = this.config;
        this.displayEl.style.color = color;
    }

    renderLCD() {
        const { digits = 6, decimals = 0, unit = '' } = this.config;
        const totalDigits = digits + (unit ? 2 : 0); // Extra space for unit

        this.element.innerHTML = `
            <div class="digital-lcd-display" id="digital-lcd-${this.id}">
                <div class="digital-lcd-screen">
                    <svg class="digital-lcd-svg" id="digital-svg-${this.id}" viewBox="0 0 ${totalDigits * 24 + 10} 48">
                        <defs>
                            <linearGradient id="lcd-bg-${this.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" style="stop-color:#c8d4c0"/>
                                <stop offset="50%" style="stop-color:#b8c4b0"/>
                                <stop offset="100%" style="stop-color:#a8b4a0"/>
                            </linearGradient>
                        </defs>
                        <rect x="0" y="0" width="100%" height="100%" fill="url(#lcd-bg-${this.id})" rx="4"/>
                        <g id="digital-digits-${this.id}" transform="translate(5, 6)"></g>
                    </svg>
                </div>
            </div>
        `;
        this.svgEl = this.element.querySelector(`#digital-svg-${this.id}`);
        this.digitsGroup = this.element.querySelector(`#digital-digits-${this.id}`);
        this.updateSegmentDisplay('----');
    }

    renderLED() {
        const { digits = 6, decimals = 0, unit = '', color = '#ff0000' } = this.config;
        const totalDigits = digits + (unit ? 2 : 0);

        this.element.innerHTML = `
            <div class="digital-led-display" id="digital-led-${this.id}">
                <div class="digital-led-screen">
                    <svg class="digital-led-svg" id="digital-svg-${this.id}" viewBox="0 0 ${totalDigits * 24 + 10} 48">
                        <defs>
                            <filter id="led-glow-${this.id}" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="1.5" result="blur"/>
                                <feMerge>
                                    <feMergeNode in="blur"/>
                                    <feMergeNode in="blur"/>
                                    <feMergeNode in="SourceGraphic"/>
                                </feMerge>
                            </filter>
                            <linearGradient id="led-bg-${this.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" style="stop-color:#2a2a2a"/>
                                <stop offset="50%" style="stop-color:#1a1a1a"/>
                                <stop offset="100%" style="stop-color:#0a0a0a"/>
                            </linearGradient>
                        </defs>
                        <rect x="0" y="0" width="100%" height="100%" fill="url(#led-bg-${this.id})" rx="4"/>
                        <g id="digital-digits-${this.id}" transform="translate(5, 6)"></g>
                    </svg>
                </div>
            </div>
        `;
        this.svgEl = this.element.querySelector(`#digital-svg-${this.id}`);
        this.digitsGroup = this.element.querySelector(`#digital-digits-${this.id}`);
        this.updateSegmentDisplay('----');
    }

    // Render a single 7-segment digit at position x
    renderDigit(char, x, isLCD = true) {
        const pattern = DigitalWidget.SEGMENT_PATTERNS[char];
        if (!pattern) return '';

        const { color = '#22c55e' } = this.config;

        // Handle special characters
        if (pattern === 'dot') {
            const onColor = isLCD ? '#3a4a3a' : color;
            const glowFilter = isLCD ? '' : `filter="url(#led-glow-${this.id})"`;
            return `<circle cx="${x + 4}" cy="33" r="2.5" fill="${onColor}" ${glowFilter}/>`;
        }
        if (pattern === 'colon') {
            const onColor = isLCD ? '#3a4a3a' : color;
            const glowFilter = isLCD ? '' : `filter="url(#led-glow-${this.id})"`;
            return `
                <circle cx="${x + 4}" cy="14" r="2" fill="${onColor}" ${glowFilter}/>
                <circle cx="${x + 4}" cy="26" r="2" fill="${onColor}" ${glowFilter}/>
            `;
        }

        // Segment colors
        const onColor = isLCD ? '#3a4a3a' : color;
        const offColor = isLCD ? 'rgba(58, 74, 58, 0.15)' : 'rgba(255, 255, 255, 0.03)';
        const glowFilter = isLCD ? '' : `filter="url(#led-glow-${this.id})"`;

        // Segment paths (relative to digit position)
        // Each digit is 20px wide, 36px tall
        const w = 16, h = 32, t = 3; // width, height, thickness
        const segments = [
            // a - top horizontal
            `<polygon points="${x+2},0 ${x+w-2},0 ${x+w-4},${t} ${x+4},${t}" fill="${pattern[0] ? onColor : offColor}" ${pattern[0] ? glowFilter : ''}/>`,
            // b - top right vertical
            `<polygon points="${x+w},${2} ${x+w},${h/2-2} ${x+w-t},${h/2-4} ${x+w-t},${4}" fill="${pattern[1] ? onColor : offColor}" ${pattern[1] ? glowFilter : ''}/>`,
            // c - bottom right vertical
            `<polygon points="${x+w},${h/2+2} ${x+w},${h-2} ${x+w-t},${h-4} ${x+w-t},${h/2+4}" fill="${pattern[2] ? onColor : offColor}" ${pattern[2] ? glowFilter : ''}/>`,
            // d - bottom horizontal
            `<polygon points="${x+4},${h-t} ${x+w-4},${h-t} ${x+w-2},${h} ${x+2},${h}" fill="${pattern[3] ? onColor : offColor}" ${pattern[3] ? glowFilter : ''}/>`,
            // e - bottom left vertical
            `<polygon points="${x},${h/2+2} ${x+t},${h/2+4} ${x+t},${h-4} ${x},${h-2}" fill="${pattern[4] ? onColor : offColor}" ${pattern[4] ? glowFilter : ''}/>`,
            // f - top left vertical
            `<polygon points="${x},${2} ${x+t},${4} ${x+t},${h/2-4} ${x},${h/2-2}" fill="${pattern[5] ? onColor : offColor}" ${pattern[5] ? glowFilter : ''}/>`,
            // g - middle horizontal
            `<polygon points="${x+3},${h/2-t/2} ${x+w-3},${h/2-t/2} ${x+w-4},${h/2} ${x+w-3},${h/2+t/2} ${x+3},${h/2+t/2} ${x+4},${h/2}" fill="${pattern[6] ? onColor : offColor}" ${pattern[6] ? glowFilter : ''}/>`,
        ];

        return segments.join('');
    }

    updateSegmentDisplay(text) {
        if (!this.digitsGroup) return;

        const { style = 'default' } = this.config;
        const isLCD = style === 'lcd';

        let html = '';
        let x = 0;
        for (const char of text) {
            if (char === '.' || char === ':') {
                html += this.renderDigit(char, x, isLCD);
                x += 8; // Smaller width for dot/colon
            } else {
                html += this.renderDigit(char, x, isLCD);
                x += 22; // Full digit width + spacing
            }
        }

        this.digitsGroup.innerHTML = html;

        // Update SVG viewBox to fit content
        if (this.svgEl) {
            this.svgEl.setAttribute('viewBox', `0 0 ${x + 10} 48`);
        }
    }

    update(value, error = null) {
        super.update(value, error);

        const { style = 'default', decimals = 0, digits = 6, color = '#22c55e', unit = '' } = this.config;

        if (style === 'default') {
            if (!this.displayEl) return;

            if (error) {
                this.displayEl.textContent = 'ERR';
                this.displayEl.style.color = 'var(--accent-red)';
                return;
            }

            const numValue = parseFloat(value) || 0;
            let text = numValue.toFixed(decimals);

            // Pad with zeros if needed
            const parts = text.split('.');
            const intPart = parts[0].padStart(digits - (decimals > 0 ? decimals + 1 : 0), '0');
            text = decimals > 0 ? `${intPart}.${parts[1]}` : intPart;

            if (unit) {
                text += ` ${unit}`;
            }

            this.displayEl.textContent = text;
            this.displayEl.style.color = color;
        } else {
            // LCD or LED style
            if (!this.digitsGroup) return;

            if (error) {
                this.updateSegmentDisplay('ERR');
                return;
            }

            const numValue = parseFloat(value) || 0;
            let text = numValue.toFixed(decimals);

            // Pad with leading spaces/zeros
            const parts = text.split('.');
            const intPart = parts[0].padStart(digits - (decimals > 0 ? decimals + 1 : 0), ' ');
            text = decimals > 0 ? `${intPart}.${parts[1]}` : intPart;

            this.updateSegmentDisplay(text);
        }
    }

    static getConfigForm(config = {}) {
        return `
            <div class="widget-config-field">
                <label>Sensor</label>
                <input type="text" class="widget-input" name="sensor"
                       value="${escapeHtml(config.sensor || '')}" placeholder="Type to search..." autocomplete="off">
            </div>
            <div class="widget-config-field">
                <label>Label</label>
                <input type="text" class="widget-input" name="label"
                       value="${escapeHtml(config.label || '')}" placeholder="Display label">
            </div>
            <div class="widget-config-field">
                <label>Style</label>
                <select class="widget-select" name="style">
                    <option value="default" ${!config.style || config.style === 'default' ? 'selected' : ''}>Default (Orbitron font)</option>
                    <option value="lcd" ${config.style === 'lcd' ? 'selected' : ''}>LCD (7-segment, light)</option>
                    <option value="led" ${config.style === 'led' ? 'selected' : ''}>LED (7-segment, glow)</option>
                </select>
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Digits</label>
                    <input type="number" class="widget-input" name="digits"
                           value="${config.digits ?? 6}" min="1" max="12">
                </div>
                <div class="widget-config-field">
                    <label>Decimals</label>
                    <input type="number" class="widget-input" name="decimals"
                           value="${config.decimals ?? 0}" min="0" max="4">
                </div>
            </div>
            <div class="widget-config-row">
                <div class="widget-config-field">
                    <label>Color</label>
                    <input type="color" class="widget-input" name="color"
                           value="${config.color || '#22c55e'}" style="height: 38px; padding: 4px;">
                </div>
                <div class="widget-config-field">
                    <label>Unit</label>
                    <input type="text" class="widget-input" name="unit"
                           value="${escapeHtml(config.unit || '')}" placeholder="Optional">
                </div>
            </div>
        `;
    }

    static parseConfigForm(form) {
        return {
            sensor: form.querySelector('[name="sensor"]')?.value || '',
            label: form.querySelector('[name="label"]')?.value || '',
            style: form.querySelector('[name="style"]')?.value || 'default',
            digits: parseInt(form.querySelector('[name="digits"]')?.value) || 6,
            decimals: parseInt(form.querySelector('[name="decimals"]')?.value) || 0,
            color: form.querySelector('[name="color"]')?.value || '#22c55e',
            unit: form.querySelector('[name="unit"]')?.value || ''
        };
    }
}

// ============================================================================
// Chart Widget (Chart.js based)
// ============================================================================

class ChartWidget extends DashboardWidget {
    static type = 'chart';
    static displayName = 'Chart';
    static description = 'Real-time line chart with multiple sensors';
    static icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
    static defaultSize = { width: 24, height: 12 };

    // Default colors for sensors
    static COLORS = [
        '#3274d9', '#73bf69', '#f2cc0c', '#ff6b6b', '#a855f7',
        '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#8b5cf6'
    ];

    constructor(id, config, container) {
        super(id, config, container);
        this.charts = new Map();      // zoneId -> Chart.js instance
        this.sensorData = new Map();  // sensorName -> { value, timestamp }
        this.chartStartTime = Date.now();
        this.updateInterval = null;
        this.visibilityHandler = null;
    }

    render() {
        const { zones = [], showTable = true, tableHeight = 100 } = this.config;

        this.element = document.createElement('div');
        this.element.className = 'widget-content chart-widget-content';

        // Zones container
        const zonesHtml = zones.map((zone, idx) => `
            <div class="chart-widget-zone" data-zone-id="${zone.id || `zone-${idx}`}">
                <canvas id="chart-canvas-${this.id}-${idx}"></canvas>
            </div>
        `).join('');

        // Table container (if enabled) - IONC table style
        const tableHtml = showTable ? `
            <div class="chart-widget-table-container" style="height: ${tableHeight}px;">
                <div class="chart-widget-table-resizer"></div>
                <div class="chart-widget-table-scroll">
                    <table class="chart-widget-table">
                        <thead>
                            <tr>
                                <th class="col-color"></th>
                                <th class="col-id">ID</th>
                                <th class="col-name">Name</th>
                                <th class="col-type">Type</th>
                                <th class="col-value">Value</th>
                                <th class="col-status">Status</th>
                                <th class="col-supplier">Supplier</th>
                            </tr>
                        </thead>
                        <tbody id="chart-table-${this.id}">
                        </tbody>
                    </table>
                </div>
            </div>
        ` : '';

        // Get saved zones height or use default
        const zonesHeight = this.config.zonesHeight || 150;

        this.element.innerHTML = `
            <div class="chart-widget-zones" style="height: ${zonesHeight}px;">
                ${zonesHtml}
                <div class="chart-widget-zones-resizer"></div>
            </div>
            ${tableHtml}
        `;

        this.container.appendChild(this.element);

        // Initialize charts
        this.initCharts();

        // Initialize zones resizer
        this.initZonesResizer();

        // Initialize table
        if (showTable) {
            this.initTable();
            this.initTableResizer();
        }

        // Load history for all sensors
        this.loadHistory();

        // Start periodic update interval (every 2 seconds, only when visible)
        this.updateInterval = setInterval(() => {
            if (!document.hidden && this.charts.size > 0) {
                this.syncTimeRange();
            }
        }, 2000);

        // Add visibility change handler
        this.visibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                // Force refresh charts when page becomes visible
                this.syncTimeRange();
            }
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    initCharts() {
        const { zones = [], useTextname = false } = this.config;

        zones.forEach((zone, idx) => {
            const canvas = this.element.querySelector(`#chart-canvas-${this.id}-${idx}`);
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            const datasets = (zone.sensors || []).map((sensor, sensorIdx) => {
                let label = sensor.label || sensor.name;
                if (useTextname && !sensor.label) {
                    const sensorInfo = typeof getSensorInfo === 'function' ? getSensorInfo(sensor.name) : null;
                    if (sensorInfo?.textname) {
                        label = sensorInfo.textname;
                    }
                }
                return {
                    label,
                    data: [],
                    borderColor: sensor.color || ChartWidget.COLORS[sensorIdx % ChartWidget.COLORS.length],
                    backgroundColor: `${sensor.color || ChartWidget.COLORS[sensorIdx % ChartWidget.COLORS.length]}20`,
                    fill: sensor.fill !== false,
                    tension: sensor.stepped ? 0 : (sensor.smooth !== false ? 0.3 : 0),
                    stepped: sensor.stepped ? 'before' : false,
                    pointRadius: 0,
                    borderWidth: sensor.stepped ? 2 : 1.5
                };
            });

            const timeRange = this.getTimeRange();
            const chart = new Chart(ctx, {
                type: 'line',
                data: { datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    normalized: true,
                    parsing: false,
                    spanGaps: true,
                    interaction: {
                        mode: 'nearest',
                        intersect: false
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            enabled: true,
                            backgroundColor: '#22252a',
                            titleColor: '#d8dce2',
                            bodyColor: '#d8dce2',
                            borderColor: '#333840',
                            borderWidth: 1
                        },
                        decimation: {
                            enabled: true,
                            algorithm: 'min-max'
                        }
                    },
                    scales: {
                        x: {
                            type: 'time',
                            display: true,
                            min: timeRange.min,
                            max: timeRange.max,
                            grid: {
                                color: '#333840',
                                drawBorder: false
                            },
                            ticks: {
                                color: '#8a9099',
                                maxTicksLimit: 6,
                                autoSkip: true,
                                source: 'auto'
                            },
                            time: {
                                displayFormats: {
                                    second: 'HH:mm:ss',
                                    minute: 'HH:mm',
                                    hour: 'HH:mm'
                                }
                            }
                        },
                        y: {
                            display: true,
                            position: 'left',
                            grid: {
                                color: '#333840',
                                drawBorder: false
                            },
                            ticks: {
                                color: '#8a9099',
                                maxTicksLimit: 5
                            }
                        }
                    }
                }
            });

            this.charts.set(zone.id || `zone-${idx}`, {
                chart,
                sensors: zone.sensors || []
            });
        });
    }

    initTable() {
        const { zones = [], useTextname = false } = this.config;
        const tbody = this.element.querySelector(`#chart-table-${this.id}`);
        if (!tbody) return;

        // Collect all sensors from all zones with zone index
        const allSensors = [];
        zones.forEach((zone, zoneIdx) => {
            (zone.sensors || []).forEach((sensor, sensorIdx) => {
                // Get sensor info from global state
                const sensorInfo = typeof getSensorInfo === 'function' ? getSensorInfo(sensor.name) : null;
                allSensors.push({
                    ...sensor,
                    zoneIdx,
                    sensorIdx,
                    zoneId: zone.id || `zone-${zoneIdx}`,
                    color: sensor.color || ChartWidget.COLORS[sensorIdx % ChartWidget.COLORS.length],
                    iotype: sensorInfo?.iotype || '',
                    textname: sensorInfo?.textname || ''
                });
            });
        });

        // IONC-style table rows
        tbody.innerHTML = allSensors.map((sensor, idx) => {
            const safeId = sensor.name.replace(/[^a-zA-Z0-9]/g, '_');
            const sensorInfo = typeof getSensorInfo === 'function' ? getSensorInfo(sensor.name) : null;
            const sensorId = sensorInfo?.id || '';
            const supplier = sensorInfo?.supplier || '';
            // Use textname if enabled and available
            const displayName = (useTextname && sensor.textname) ? sensor.textname : sensor.name;
            return `
            <tr data-sensor="${escapeHtml(sensor.name)}" data-zone="${sensor.zoneIdx}" data-idx="${sensor.sensorIdx}">
                <td class="col-color">
                    <span class="color-indicator" style="background: ${sensor.color}"></span>
                </td>
                <td class="col-id">${escapeHtml(String(sensorId))}</td>
                <td class="col-name" title="${escapeHtml(sensor.name)}">${escapeHtml(displayName)}</td>
                <td class="col-type">
                    ${sensor.iotype ? `<span class="type-badge type-${sensor.iotype}">${sensor.iotype}</span>` : ''}
                </td>
                <td class="col-value" id="chart-value-${this.id}-${safeId}" style="color: ${sensor.color}">--</td>
                <td class="col-status">—</td>
                <td class="col-supplier">${escapeHtml(supplier)}</td>
            </tr>
        `}).join('');
    }

    initTableResizer() {
        const container = this.element.querySelector('.chart-widget-table-container');
        const resizer = this.element.querySelector('.chart-widget-table-resizer');
        if (!container || !resizer) return;

        let startY, startHeight;

        const onMouseMove = (e) => {
            const delta = startY - e.clientY;
            const newHeight = Math.max(50, Math.min(300, startHeight + delta));
            container.style.height = `${newHeight}px`;
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';

            // Save new height to config
            this.config.tableHeight = parseInt(container.style.height);
            // Trigger save through dashboard manager
            if (window.dashboardManager) {
                dashboardManager.saveDashboard();
            }
        };

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startY = e.clientY;
            startHeight = container.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    initZonesResizer() {
        const zones = this.element.querySelector('.chart-widget-zones');
        const resizer = this.element.querySelector('.chart-widget-zones-resizer');
        if (!zones || !resizer) return;

        let startY, startHeight;

        const onMouseMove = (e) => {
            const delta = e.clientY - startY;
            const newHeight = Math.max(80, Math.min(500, startHeight + delta));
            zones.style.height = `${newHeight}px`;
            // Trigger chart resize
            this.charts.forEach(({ chart }) => chart.resize());
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';

            // Save new height to config
            this.config.zonesHeight = parseInt(zones.style.height);
            // Trigger save through dashboard manager
            if (window.dashboardManager) {
                dashboardManager.saveDashboard();
            }
        };

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startY = e.clientY;
            startHeight = zones.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    getTimeRange() {
        // Use widget's own timeRange or default to 15 minutes
        const rangeMs = this.config.timeRange || 900000;
        const now = Date.now();

        let min = this.chartStartTime;
        let max = min + rangeMs;

        // Shift window if current time exceeds
        if (now >= max) {
            const shiftAmount = rangeMs * 0.9;
            this.chartStartTime = min + shiftAmount;
            min = this.chartStartTime;
            max = min + rangeMs;
        }

        return { min, max };
    }

    async loadHistory() {
        const { zones = [] } = this.config;

        for (const zone of zones) {
            const chartData = this.charts.get(zone.id);
            if (!chartData) continue;

            for (let i = 0; i < (zone.sensors || []).length; i++) {
                const sensor = zone.sensors[i];
                try {
                    // Try to load history from SM API
                    const response = await fetch(`/api/sm/sensors/${encodeURIComponent(sensor.name)}/history?limit=200`);
                    if (response.ok) {
                        const history = await response.json();
                        if (history.points && history.points.length > 0) {
                            // Use timestamp as number for decimation to work
                            const data = history.points.map(p => ({
                                x: new Date(p.timestamp).getTime(),
                                y: p.value
                            }));
                            chartData.chart.data.datasets[i].data = data;
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to load history for ${sensor.name}:`, e);
                }
            }

            chartData.chart.update('none');
        }
    }

    update(value, error = null) {
        // This is called for the main sensor (config.sensor)
        // Chart widget uses updateSensor instead
    }

    // Called from SSE handler for each sensor update
    updateSensor(sensorName, value, timestamp = null) {
        // Use timestamp as number for decimation to work with parsing: false
        const ts = timestamp ? new Date(timestamp).getTime() : Date.now();

        // Store current value
        this.sensorData.set(sensorName, { value, timestamp: ts });

        // Update table value
        const safeId = sensorName.replace(/[^a-zA-Z0-9]/g, '_');
        const valueEl = this.element?.querySelector(`#chart-value-${this.id}-${safeId}`);
        if (valueEl) {
            valueEl.textContent = typeof value === 'number' ? value.toFixed(2) : value;
        }

        // Add point to chart
        const { zones = [] } = this.config;
        for (const zone of zones) {
            const chartData = this.charts.get(zone.id);
            if (!chartData) continue;

            const sensorIdx = (zone.sensors || []).findIndex(s => s.name === sensorName);
            if (sensorIdx === -1) continue;

            const dataset = chartData.chart.data.datasets[sensorIdx];
            if (!dataset) continue;

            dataset.data.push({ x: ts, y: value });

            // Limit data points
            if (dataset.data.length > 1000) {
                dataset.data.shift();
            }
        }
    }

    // Called periodically to sync time range and update charts
    syncTimeRange() {
        const timeRange = this.getTimeRange();

        this.charts.forEach(({ chart }) => {
            chart.options.scales.x.min = timeRange.min;
            chart.options.scales.x.max = timeRange.max;
            chart.update('none');
        });
    }

    // Get all sensor names for SSE subscription
    getSensorNames() {
        const { zones = [] } = this.config;
        const names = new Set();
        zones.forEach(zone => {
            (zone.sensors || []).forEach(sensor => {
                names.add(sensor.name);
            });
        });
        return Array.from(names);
    }

    destroy() {
        // Clear update interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Remove visibility handler
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }

        // Destroy all Chart.js instances
        this.charts.forEach(({ chart }) => {
            chart.destroy();
        });
        this.charts.clear();
        this.sensorData.clear();
        super.destroy();
    }

    static TIME_RANGES = [
        { value: 60000, label: '1m' },
        { value: 180000, label: '3m' },
        { value: 300000, label: '5m' },
        { value: 900000, label: '15m' },
        { value: 3600000, label: '1h' },
        { value: 10800000, label: '3h' }
    ];

    static getConfigForm(config = {}) {
        const zones = config.zones || [{ id: 'zone-0', sensors: [] }];
        const timeRange = config.timeRange || 900000; // default 15m

        return `
            <div class="widget-config-field">
                <label>Label</label>
                <input type="text" class="widget-input" name="label"
                       value="${escapeHtml(config.label || '')}" placeholder="Chart title">
            </div>
            <div class="widget-config-field">
                <label>Time Range</label>
                <div class="time-range-selector">
                    ${ChartWidget.TIME_RANGES.map(tr => `
                        <label class="time-range-btn ${timeRange === tr.value ? 'active' : ''}">
                            <input type="radio" name="timeRange" value="${tr.value}" ${timeRange === tr.value ? 'checked' : ''}>
                            <span>${tr.label}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="widget-config-field">
                <label class="toggle-label">
                    <input type="checkbox" name="showTable" ${config.showTable !== false ? 'checked' : ''}>
                    <span class="toggle-switch"></span>
                    Show sensor table
                </label>
            </div>
            <div class="widget-config-field">
                <label class="toggle-label">
                    <input type="checkbox" name="useTextname" ${config.useTextname ? 'checked' : ''}>
                    <span class="toggle-switch"></span>
                    Use textname
                </label>
            </div>
            <div class="chart-zones-editor" id="chart-zones-editor">
                ${zones.map((zone, zoneIdx) => ChartWidget.renderZoneEditor(zone, zoneIdx)).join('')}
            </div>
            <div class="widget-config-field">
                <button type="button" class="zones-add-btn" onclick="addChartZone()">+ Add Chart Zone</button>
            </div>
        `;
    }

    static renderZoneEditor(zone, zoneIdx) {
        const sensors = zone.sensors || [];
        return `
            <div class="chart-zone-editor" data-zone-idx="${zoneIdx}">
                <div class="chart-zone-header">
                    <span class="chart-zone-title">Zone ${zoneIdx + 1}</span>
                    ${zoneIdx > 0 ? `<button type="button" class="zone-remove-btn" onclick="removeChartZone(${zoneIdx})">×</button>` : ''}
                </div>
                <div class="chart-zone-sensors" id="chart-zone-sensors-${zoneIdx}">
                    ${sensors.map((sensor, sensorIdx) => ChartWidget.renderSensorRow(sensor, zoneIdx, sensorIdx)).join('')}
                </div>
                <div class="chart-zone-add">
                    <input type="text" class="widget-input chart-sensor-input"
                           placeholder="Add sensor..."
                           data-zone-idx="${zoneIdx}"
                           autocomplete="off">
                </div>
            </div>
        `;
    }

    static renderSensorRow(sensor, zoneIdx, sensorIdx) {
        const color = sensor.color || ChartWidget.COLORS[sensorIdx % ChartWidget.COLORS.length];
        return `
            <div class="chart-sensor-row" data-zone-idx="${zoneIdx}" data-sensor-idx="${sensorIdx}">
                <input type="color" class="chart-sensor-color" value="${color}"
                       onchange="updateChartSensorColor(${zoneIdx}, ${sensorIdx}, this.value)">
                <span class="chart-sensor-name">${escapeHtml(sensor.name)}</span>
                <div class="chart-sensor-options">
                    <label class="chart-sensor-option" title="Smooth line (bezier)">
                        <input type="checkbox" name="sensor-${zoneIdx}-${sensorIdx}-smooth" ${sensor.smooth !== false ? 'checked' : ''}>
                        <span>smooth</span>
                    </label>
                    <label class="chart-sensor-option" title="Fill area under line">
                        <input type="checkbox" name="sensor-${zoneIdx}-${sensorIdx}-fill" ${sensor.fill !== false ? 'checked' : ''}>
                        <span>fill</span>
                    </label>
                    <label class="chart-sensor-option" title="Stepped line (discrete)">
                        <input type="checkbox" name="sensor-${zoneIdx}-${sensorIdx}-stepped" ${sensor.stepped ? 'checked' : ''}>
                        <span>stepped</span>
                    </label>
                </div>
                <button type="button" class="chart-sensor-remove" onclick="removeChartSensor(${zoneIdx}, ${sensorIdx})">×</button>
                <input type="hidden" name="sensor-${zoneIdx}-${sensorIdx}-name" value="${escapeHtml(sensor.name)}">
                <input type="hidden" name="sensor-${zoneIdx}-${sensorIdx}-color" value="${color}">
            </div>
        `;
    }

    static parseConfigForm(form) {
        const zones = [];
        const zoneEditors = form.querySelectorAll('.chart-zone-editor');

        zoneEditors.forEach((editor, zoneIdx) => {
            const sensors = [];
            const sensorRows = editor.querySelectorAll('.chart-sensor-row');

            sensorRows.forEach((row, sensorIdx) => {
                const name = row.querySelector('input[type="hidden"][name$="-name"]')?.value;
                const color = row.querySelector('input[type="hidden"][name$="-color"]')?.value;
                const smooth = form.querySelector(`[name="sensor-${zoneIdx}-${sensorIdx}-smooth"]`)?.checked !== false;
                const fill = form.querySelector(`[name="sensor-${zoneIdx}-${sensorIdx}-fill"]`)?.checked !== false;
                const stepped = form.querySelector(`[name="sensor-${zoneIdx}-${sensorIdx}-stepped"]`)?.checked || false;

                if (name) {
                    sensors.push({ name, color, smooth, fill, stepped });
                }
            });

            zones.push({
                id: `zone-${zoneIdx}`,
                sensors
            });
        });

        // Get timeRange from radio button
        const timeRangeInput = form.querySelector('[name="timeRange"]:checked');
        const timeRange = timeRangeInput ? parseInt(timeRangeInput.value) : 900000;

        return {
            label: form.querySelector('[name="label"]')?.value || '',
            timeRange,
            showTable: form.querySelector('[name="showTable"]')?.checked !== false,
            useTextname: form.querySelector('[name="useTextname"]')?.checked || false,
            tableHeight: 100,
            zones
        };
    }
}
