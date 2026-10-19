/* =====================================================================
   Lighting moods, as data: what each one sets (see lighting.js). Apart
   from lighting.js so the store and start screen don't load three.js.
   ===================================================================== */

/* hdri.azimuth: where the panorama's main light is (0 = the camera's side,
   positive to the right, as the Direction slider); exposure: brings each
   panorama to a common brightness (they're photographed at different ones);
   the Ambient slider scales from there. */
export const MOODS = {
  studio: {
    label: 'Softbox studio',
    hdri: { file: 'studio_kontrast_04', azimuth: -56, exposure: 0.75 },
    light: { key: 1.0, env: 1.0, angle: -45, elevation: 35, color: '#ffffff' },
    rim: 0.3,
    background: { mode: 'gradient', top: '#e7e9ec', bottom: '#c3c7cd' },
    ground: { shadow: 0.6, softness: 0.35 },
  },
  highkey: {
    label: 'High key',
    hdri: { file: 'story_studio_05', azimuth: 0, exposure: 5 },   // lit from overhead; its walls are dim
    light: { key: 0.5, env: 1.0, angle: -20, elevation: 60, color: '#ffffff' },
    rim: 0,
    background: { mode: 'gradient', top: '#ffffff', bottom: '#eceef1' },
    ground: { shadow: 0.38, softness: 0.6 },
  },
  lowkey: {
    label: 'Low key',
    // the room is held well down, so the octaboxes' highlights carry the shot
    hdri: { file: 'studio_small_09', azimuth: 56, exposure: 0.3 },
    light: { key: 1.1, env: 1.0, angle: 60, elevation: 30, color: '#ffffff' },
    rim: 2.2,
    background: { mode: 'gradient', top: '#2a2d33', bottom: '#08090b' },
    ground: { shadow: 0.7, softness: 0.3 },
  },
  window: {
    label: 'Window light',
    hdri: { file: 'brown_photostudio_04', azimuth: 72, exposure: 0.8 },
    light: { key: 1.3, env: 1.0, angle: -70, elevation: 20, color: '#fff6ea' },
    rim: 0,
    background: { mode: 'gradient', top: '#f2eee7', bottom: '#d6cfc3' },
    ground: { shadow: 0.6, softness: 0.4 },
  },
  golden: {
    label: 'Golden hour',
    hdri: { file: 'qwantani_dusk_2_puresky', azimuth: 72, exposure: 0.75 },
    light: { key: 2.0, env: 1.0, angle: 70, elevation: 14, color: '#ffa880' },
    rim: 0,
    background: { mode: 'gradient', top: '#f2d3b0', bottom: '#b68564' },
    ground: { shadow: 0.5, softness: 0.3 },
  },
};

/* Moods from before the setups above; saved scenes keep working. */
const ALIASES = { daylight: 'window', sunset: 'golden', night: 'lowkey', bright: 'highkey' };
export const resolveMood = (id) => (MOODS[id] ? id : ALIASES[id] || null);
