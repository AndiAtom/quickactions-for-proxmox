/**
 * icons.js — inline SVG icons for popup and options
 *
 * Replaces emojis (platform-dependent rendering) with consistent,
 * stroke-based SVGs. Uses currentColor so the icons
 * can be colored via CSS (accent/danger).
 *
 * All icons: 16×16 viewBox, stroke-width 1.6, stroke-linecap round.
 * Built entirely via the DOM API — no innerHTML (web-ext lint clean).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Helper: creates an SVG element with attributes.
 * @param {string} tag - e.g. "path", "circle"
 * @param {Object} attrs - attribute map
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
 * Icon factory: builds the SVG via the DOM API.
 * @param {number} size - width/height in px
 * @param {Function} draw - callback that draws the shapes into a <g>
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
  /** Start — filled triangle */
  start: () => buildIcon(14, (svg) => {
    svg.appendChild(svgEl("path", {
      d: "M4.5 2.8v10.4c0 .6.7 1 1.2.6l7.4-5.2c.5-.3.5-1 0-1.3L5.7 2.2c-.5-.3-1.2.1-1.2.6z",
      fill: "currentColor"
    }));
  }),

  /** Reboot — circular arrow */
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

  /** Shutdown — power symbol (matching the add-on icon) */
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

  /** Snapshot — camera */
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

  /** Backup — floppy disk */
  backup: () => buildIcon(14, (svg) => {
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M2 2.8A1.8 1.8 0 0 1 3.8 1h8.4L15 3.8v9.4A1.8 1.8 0 0 1 13.2 15H3.8A1.8 1.8 0 0 1 2 13.2V2.8z"
    }));
    svg.appendChild(svgEl("path", { ...strokeAttrs, d: "M5 1v4h6V1" }));
    svg.appendChild(svgEl("path", { ...strokeAttrs, d: "M4.5 15v-4.5h7V15" }));
  }),

  /** Refresh — circular arrow (smaller, for footer text buttons) */
  refresh: () => buildIcon(12, (svg) => {
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9"
    }));
    svg.appendChild(svgEl("path", {
      ...strokeAttrs,
      d: "M13.7 1.8v2.9h-2.9"
    }));
  }),

  /** Host — server rack (PVE node itself, distinguishable from the guests) */
  host: () => buildIcon(14, (svg) => {
    // Upper rack unit
    svg.appendChild(svgEl("rect", {
      ...strokeAttrs,
      x: 1.8, y: 1.8, width: 12.4, height: 5, rx: 1
    }));
    // Lower rack unit
    svg.appendChild(svgEl("rect", {
      ...strokeAttrs,
      x: 1.8, y: 9.2, width: 12.4, height: 5, rx: 1
    }));
    // Status LEDs
    svg.appendChild(svgEl("circle", {
      fill: "currentColor",
      cx: 4.2, cy: 4.3, r: 0.9
    }));
    svg.appendChild(svgEl("circle", {
      fill: "currentColor",
      cx: 4.2, cy: 11.7, r: 0.9
    }));
    // Ventilation slots
    svg.appendChild(svgEl("path", { ...strokeAttrs, d: "M8.5 3.8h3.8" }));
    svg.appendChild(svgEl("path", { ...strokeAttrs, d: "M8.5 11.2h3.8" }));
  })
};

/**
 * Creates an icon element. Fully DOM-based (no innerHTML).
 * @param {string} name - key from ICON_BUILDERS
 * @returns {HTMLElement} - span.icon-wrapper with SVG
 */
function createIcon(name) {
  const builder = ICON_BUILDERS[name];
  return builder ? builder() : document.createElement("span");
}
