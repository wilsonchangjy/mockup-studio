# Mockup Studio

Compose 3D device mockups from your screen recordings and export them as video
or images, entirely in your browser.

![A Studio Display, MacBook Pro, iPad and iPhone composed in Mockup Studio's Ecosystem template](docs/preview.png)

Built because most mockup tools either produce stills, watermark the output, or
only allow **one** device per composition.

## What it does

- Drop in screen recordings or images. Each is matched to a device by its
  resolution, and a starting scene is laid out for you.
  A 1179×2556 recording becomes an iPhone 15 Pro; 2560×1664, a MacBook Air.
- Or start from a template — the arrangements mockups use most: isometric,
  phone pair, flat lay, laptop + phone, or the full ecosystem.
- Move and rotate devices with one on-canvas gizmo: arrows to move, rings to
  rotate, as in Maya or Spline.
- Devices are true to size and can't be scaled, so they stay realistic next to
  each other. The camera is a fixed 50mm lens: consistent framing, no
  wide-angle distortion.
- Devices stand on the floor; any of them can float instead, with a gentle
  bob and tilt. Camera motions from product video (push in or pull back,
  turntable either way, slide either way, crane, handheld drift), backgrounds,
  and a shadow-catching or solid floor with adjustable shadow softness.
- Lighting moods recreating standard product-photography setups — Softbox
  studio, High key, Low key, Window light, Golden hour — each lit by a real
  photographed studio (an HDRI) and setting the reflections, key light,
  background and shadow together, then adjustable. Reflections turn with the
  light's direction. Screens can ignore the light,
  take a matte sheen, or reflect it like glossy glass. Every settings section
  has its own reset.
- Export **MP4** (with a quality slider and file-size estimate), **PNG** (background optional,
  so the device and its soft shadow can sit on transparency) or **JPG**.

**Your footage never leaves your device.** Decoding, rendering and encoding all
happen in the browser. Nothing is uploaded or stored on a server.

## Devices

| | |
| --- | --- |
| Phones | iPhone 15 Pro · iPhone 15 Pro Max · iPhone Duo · Pixel 6 Pro · Galaxy S26 · Galaxy S26 Ultra · Galaxy Z Flip7 · Galaxy Z Fold8 |
| Tablets | iPad Pro 11" · iPad Pro 13" · iPad mini |
| Watches | Apple Watch Series 9 · Apple Watch Ultra 2 |
| Laptops | MacBook Air 13" · MacBook Air 15" · MacBook Pro 14" · MacBook Pro 16" |
| Displays | iMac 24" · Studio Display · Pro Display XDR |

Each comes in its real finishes, plus a custom colour. Laptops' lids open
from closed to 135°, and the iMac and Studio Display tilt on their stands
as the real ones do. Foldables (Z Flip7, Z Fold8, iPhone Duo) are open or
closed. Open, they fold anywhere from 180° (flat) to 0° (shut), like a laptop's lid,
and both screens take footage: the inner one, and the cover screen on the
back. Closing swaps them, so the cover screen's footage comes to the
front.

Every device is a 3D model of the real hardware made by the community
(credited below), prepared for the app: trimmed to the device, logos
removed, made recolourable, given a working hinge where it has one, and
compressed. A model downloads the first time its device is used. None are
the manufacturers' own 3D assets.

Models marked **NC** in the app (the Galaxy S26, S26 Ultra, Z Flip7, Z Fold8
and iPhone Duo) are licensed CC BY-NC-SA 4.0: images and videos made with
them are for non-commercial use only. The inspector and export panel say so
whenever one is in the scene.

Uploads are matched to Apple devices first. A Pixel or Galaxy is picked only
when a recording's size is exactly that phone's and no iPhone's; a
foldable's cover-screen size picks it closed.

### Adding or updating a detailed model

`scripts/prepare-models.mjs` turns a Sketchfab glTF download into the GLB the
app loads from `public/models/`. Unzip the download into `Models/<name>/`
(ignored by git), add an entry to `CONFIG` in the script — which part is the
screen, which parts to remove, which carry the product colour, and for a
laptop or display which part pivots — and run:

```bash
node scripts/prepare-models.mjs <model-id> --list    # every part, in the app's frame
node scripts/prepare-models.mjs <model-id> --debug   # trimmed copy with part names, for a viewer
node scripts/prepare-models.mjs <model-id>           # write public/models/<model-id>.glb
```

Then point the model's entry in `src/devices.js` at it with
`glb: { file, native }`, where `native` is the finish it was modelled in
(or `recolour: 'assign'` for a model made in black). The options are
documented at the top of the script.

A foldable is two entries in `CONFIG`, one per form, from the same download
(the files model both); its `src/devices.js` entry names the second under
`closed`.

## Running it

Requires Node 20.19+ or 22.12+ (what Vite 8 needs).

```bash
npm install
npm run dev        # development server with hot reload → http://localhost:5180
```

### Testing the built site with Live Server

The source can't be served directly, because it imports `three` and `mp4box`
by package name, which only a bundler resolves. Build it first, then serve the
output:

```bash
npm run build      # writes the static site to dist/
```

In VS Code, right-click **`dist/index.html` → Open with Live Server**. The
build uses relative paths, so it works from the `dist/` subfolder as-is.

To have Live Server open `dist/` directly, add this to your VS Code workspace
settings:

```json
{ "liveServer.settings.root": "/dist" }
```

To rebuild automatically while Live Server is open, run
`npx vite build --watch` in a terminal.

`npm run preview` serves the built site without Live Server.

Use `http://localhost` or `http://127.0.0.1`. Video export uses WebCodecs, which
browsers only enable on secure origins, and localhost counts as one. Opening
`index.html` straight from disk (`file://`) won't work.

### Hosting

`dist/` is a plain static site. Upload it to any static host: Vercel,
Netlify, GitHub Pages, Cloudflare Pages. There is no server component.

It's hosted on Cloudflare Pages: build command `npm run build`, output
directory `dist`. `public/_headers` sets the caching there: Vite's hashed
files are cached for good, models and lighting panoramas for a week. Other
hosts ignore that file.

## Using it

| | |
| --- | --- |
| **Scene** tab | Pick devices, add new ones, start from a template |
| **Assets** tab | Uploaded media. Drag a file onto any screen to place it, or click it to place it on the selected device |
| **Export** tab | Format, size, bitrate, background; progress and cancel while rendering |
| **Inspector** (right) | The selected device (model, lid angle or tilt, orientation, position, rotation, finish, footage, float), or scene settings when nothing is selected |
| Stage | Numbers on each device, the selected one outlined and named; **Replace media** under the selection, or on any screen you hover. **Hide UI** (H) hides the labels for a clean view |

The theme follows your system, or pick **Light** or **Dark** at the bottom left.

Keyboard: **F** reframe · **H** show/hide UI · **Space** play ·
**Delete** remove · **⌘/Ctrl+D** duplicate · **Esc** deselect

Number fields can be typed into, or scrubbed by dragging their axis letter
or unit (Shift for coarse, Alt for fine). Landscape footage turns a phone or tablet
sideways automatically.

## How export works

The composition is a pure function of time, so export steps through it one
frame at a time: pose the scene, draw each screen's exact frame, render, and
encode with the browser's WebCodecs `VideoEncoder`, muxed to MP4. A slower
machine exports more slowly rather than dropping frames.

Images and video are rendered at up to twice the output size and scaled down,
so device edges and screen content stay crisp.

**Quality.** Video quality is a 1–100 slider, defaulting to 80: the
recommended bitrate for the frame size and rate (16 Mbps at 1080p30, 24 at
1080p60, 45 at 4K30). Every 20 steps halves or doubles it, and the panel shows
the largest file that setting can produce. The browser's encoder spends fewer
bits on simple footage, so files usually come in smaller.

PNG and JPG sizes depend on the picture, so the panel encodes the current frame
in the background and shows the actual size it would export at.

**Frames are exact.** MP4/MOV footage is demuxed and decoded sample by sample,
not by seeking a `<video>` element, and the file's edit list is honoured.
Footage encoded with B-frames needs that: ignoring the edit list leaves every
exported frame a couple of frames behind the preview. WebM or codecs the
browser can't decode fall back to seeking, and the export panel tells you when
that happens.

## Browser support

A current Chrome, Edge, Safari or Firefox. Video export needs WebCodecs; image
export works everywhere WebGL does. The app is designed for desktop screens; phones and small tablets see a notice first, with the option to continue.

## Limitations

- Media is held in memory and is gone when the tab closes. "Continue last
  scene" restores the layout but not the footage.
- No undo/redo, and no saved project files yet.
- Transparent backgrounds are image-only. MP4/H.264 has no alpha channel.

## Project layout

```
index.html        app shell
src/
  main.js         actions and wiring
  ui.js           panels, inspector, dialogs, drag & drop
  viewport.js     three.js scene, camera, gizmos, picking
  contactShadow.js  soft floor shadows
  devices.js      device library: models, finishes, hinges, screens
  lighting.js     lighting moods and their environments
  media.js        asset import and per-screen video feeds
  decoder.js      frame-exact MP4 decoding for export
  exporter.js     image and video export
  compose.js      device detection, quickstart layout, templates
  state.js        store and persistence
  styles.css      theme (light/dark) and layout
  fonts/          self-hosted fonts and their licences
public/models/    detailed device models (GLB)
public/environments/  HDRIs for the lighting moods (1K, and 2K for glossy screens)
public/templates/     renders of the templates, for the start dialog
scripts/
  prepare-models.mjs  turns downloaded models into public/models/
```

## Credits

[three.js](https://threejs.org) (MIT) ·
[mp4box.js](https://github.com/gpac/mp4box.js) (BSD-3-Clause) ·
[mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT) ·
[Vite](https://vitejs.dev) (MIT) ·
[glTF Transform](https://gltf-transform.dev), [meshoptimizer](https://github.com/zeux/meshoptimizer),
[sharp](https://sharp.pixelplumbing.com) (model preparation; MIT, MIT, Apache-2.0)

Fonts, under the [SIL Open Font License 1.1](https://openfontlicense.org)
(licence texts in `src/fonts/`):
[Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans),
[IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono),
[Doto](https://fonts.google.com/specimen/Doto).

3D models, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
and modified as described above:

- by [polyman Studio](https://sketchfab.com/Polyman_3D):
  [Apple iPhone 15 Pro Natural](https://sketchfab.com/3d-models/apple-iphone-15-pro-natural-c1749472db7b4ec8904e8c500764b61d),
  [Apple iPhone 15 Pro Max Natural](https://sketchfab.com/3d-models/apple-iphone-15-pro-max-natural-92d5a553bcc94f239c828580417efc94),
  [Ipad Pro 11in Silver 4gen](https://sketchfab.com/3d-models/ipad-pro-11in-silver-4gen-a84f3c39d2fc4b9eb7c852db116da8b7),
  [Ipad pro 13in silver m4](https://sketchfab.com/3d-models/ipad-pro-13in-silver-m4-8a113340443e49d3b905ab9f0b45efd6),
  [Apple Watch Series 9](https://sketchfab.com/3d-models/apple-watch-series-9-b6d698e718bb425a97057767f0cede47),
  [Apple Watch Ultra 2](https://sketchfab.com/3d-models/apple-watch-ultra-2-f33263c457664b43909200c5ed5e6fa2),
  [Apple Pro Display XDR](https://sketchfab.com/3d-models/apple-pro-display-xdr-7e92cfb7c84d41f886c7748be6c567da)
- by [akshatmittal](https://sketchfab.com/akshatmittal):
  [2021 Macbook Pro 14"](https://sketchfab.com/3d-models/2021-macbook-pro-14-m1-pro-m1-max-f6b0b940fb6a4286b18a674ef32af2d3),
  [2021 Macbook Pro 16"](https://sketchfab.com/3d-models/2021-macbook-pro-16-m1-pro-m1-max-3abf6b6886eb4da885637964c8893703),
  [Apple Macbook Air 13 (Space Gray) 2023](https://sketchfab.com/3d-models/apple-macbook-air-13-space-gray-2023-907bf1c943f248399e93a613eedf4897),
  [Apple Macbook Air 15 (Space Gray) 2023](https://sketchfab.com/3d-models/apple-macbook-air-15-space-gray-2023-e8d82e341c794141a2561c2c9d01d79e),
  [Apple Mac Studio System 2023](https://sketchfab.com/3d-models/apple-mac-studio-system-2023-de6b6ff028474d158252fb22ece33c2a) (the Studio Display)
- by [DatSketch](https://sketchfab.com/DatSketch):
  [iMac 2021](https://sketchfab.com/3d-models/imac-2021-304cb06ffb554883a7a642b2b56754c1),
  [IPad Mini 6 2021](https://sketchfab.com/3d-models/ipad-mini-6-2021-f363c2b1c74a462588db184bd4fb024e),
  [Google Pixel 6 Pro](https://sketchfab.com/3d-models/google-pixel-6-pro-b9b58ca40c254f8dafd8370869af74fb)

3D models licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
(non-commercial; the modified models carry the same licence), modified as
described above:

- by [zhe_kan](https://sketchfab.com/zhe_kan):
  [Apple iPhone Duo](https://sketchfab.com/3d-models/apple-iphone-duo-f6100910553946159e07518240fca910),
  [SAMSUNG Galaxy S26](https://sketchfab.com/3d-models/samsung-galaxy-s26-00f47b21ca6143fba6942fcf44e77f18),
  [SAMSUNG Galaxy S26 Ultra](https://sketchfab.com/3d-models/samsung-galaxy-s26-ultra-ee14d453cc8d4c12bf9e0b3279f2f7fb),
  [SAMSUNG Galaxy Z Flip 7](https://sketchfab.com/3d-models/samsung-galaxy-z-flip-7-9253a979bd8c473498013c00b3f28fca),
  [SAMSUNG Galaxy Z Fold8](https://sketchfab.com/3d-models/samsung-galaxy-z-fold8-dfbcbd3143e644608c758edaa0289db3)

iPhone, iPad, Apple Watch, MacBook, iMac, Studio Display and Pro Display XDR
are trademarks of Apple Inc. Pixel is a trademark of Google LLC. Galaxy is a
trademark of Samsung Electronics Co., Ltd. Mockup Studio is an independent
project, not affiliated with or endorsed by any of them.

Lighting: studio HDRIs from [Poly Haven](https://polyhaven.com), CC0 —
[Studio Kontrast 04](https://polyhaven.com/a/studio_kontrast_04),
[Story Studio 05](https://polyhaven.com/a/story_studio_05),
[Studio Small 09](https://polyhaven.com/a/studio_small_09),
[Brown Photostudio 04](https://polyhaven.com/a/brown_photostudio_04),
[Qwantani Dusk 2 (Pure Sky)](https://polyhaven.com/a/qwantani_dusk_2_puresky).

## Licence

The code is MIT; see [LICENSE](LICENSE). The 3D models in `public/models/`
keep their own licences (see Credits): CC BY 4.0, or CC BY-NC-SA 4.0 for
zhe_kan's, whose modified versions here are released under that licence too.
The fonts in `src/fonts/` are under the SIL Open Font License 1.1.
