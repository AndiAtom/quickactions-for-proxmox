/**
 * icons.js — Inline-SVG-Icons für Popup und Options
 *
 * Ersetzt Emojis (plattformabhängige Darstellung) durch konsistente,
 * stroke-basierte SVGs. Verwendung von currentColor, damit die Icons
 * per CSS eingefärbt werden (accent/danger).
 *
 * Alle Icons: 16×16 viewBox, stroke-width 1.6, stroke-linecap round.
 * Komplett per DOM-API gebaut — kein innerHTML (web-ext lint sauber).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Hilfsfunktion: erstellt ein SVG-Element mit Attributen.
 * @param {string} tag - z.B. "path", "circle"
 * @param {Object} attrs - Attribut-Map
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

/**
 * Icon-Factory: baut das SVG per DOM-API.
 * @param {number} size - Breite/Höhe in px
 * @param {Function} draw - Callback, zeichnet die Formen in ein <g>
 * @returns {HTMLElement} - span.icon-wrapper
 */
function buildIcon(size, draw) {
  const wrapper = document.createElement("span");
  wrapper.className = "icon";

  const svg = svgEl("svg", {
    viewBox: "0 0 16 16",
    width: size,
    height: size,
    "aria-hidden": "true"
  });
  draw(svg);
  wrapper.appendChild(svg);
  return wrapper;
}

const strokeAttrs = {
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.6",
  "stroke-linecap": "round",
  "stroke-linejoin": "round"
};

const ICON_BUILDERS = {
  /** Start — ausgefülltes Dreieck */
  start: () => buildIcon(14, (svg) => {
    svg.appendChild(svgEl("path", {
      d: "M4.5 2.8v10.4c0 .6.7 1 1.2.6l7.4-5.2c.5-.3.5-1 0-1.3L5.7 2.2c-.5-.3-1.2.1-1.2.6z",
      fill: "currentColor"
    }));
  }),

  /** Reboot — kreisender Pfeil */
  reboot: () => buildIcon(14, (svg) => {
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9"
    }));
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M13.7 1.8v2.9h-2.9"
    }));
  }),

  /** Shutdown — Power-Symbol (passend zum Addon-Icon) */
  shutdown: () => buildIcon(14, (svg) => {
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M8 1.8v5"
    }));
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M4.5 3.8a5.5 5.5 0 1 0 7 0"
    }));
  }),

  /** Snapshot — Kamera */
  snapshot: () => buildIcon(14, (svg) => {
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M5.2 3.4 6 2.2h4l.8 1.2H14a1 1 0 0 1 1 1v8.2a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1h3.2z"
    }));
    svg.appendChild(svgEl("circle", {
      ...strokeAttrs,
      cx: 8, cy: 8.6, r: 2.8
    }));
  }),

  /** Backup — Diskette */
  backup: () => buildIcon(14, (svg) => {
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M2 2.8A1.8 1.8 0 0 1 3.8 1h8.4L15 3.8v9.4A1.8 1.8 0 0 1 13.2 15H3.8A1.8 1.8 0 0 1 2 13.2V2.8z"
    }));
    svg.appendChild(svgEl("path", { ...strokeAttrs, d: "M5 1v4h6V1" }));
    svg.appendChild(svgEl("path", { ...strokeAttrs, d: "M4.5 15v-4.5h7V15" }));
  }),

  /** Refresh — zirkularer Pfeil (kleiner, für Footer-Textbuttons) */
  refresh: () => buildIcon(12, (svg) => {
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9"
    }));
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M13.7 1.8v2.9h-2.9"
    }));
  })
};

/**
 * Erstellt ein Icon-Element. Vollständig DOM-basiert (kein innerHTML).
 * @param {string} name - Key aus ICON_BUILDERS
 * @returns {HTMLElement} - span.icon-wrapper mit SVG
 */
function createIcon(name) {
  const builder = ICON_BUILDERS[name];
  return builder ? builder() : document.createElement("span");
}
