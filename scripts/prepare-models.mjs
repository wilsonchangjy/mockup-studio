/* =====================================================================
   Prepare device models

   Turns downloaded glTF models (Sketchfab "glTF" downloads, unzipped into
   Models/<folder>/) into the compact GLBs the app loads from public/models/.

     node scripts/prepare-models.mjs              all models
     node scripts/prepare-models.mjs iphone-15-pro --list   inspect one

   A foldable is two models from the same download, one per state (open,
   closed): the files model both, so each is used as its maker shaped it.

   For each model it:
   - keeps only the device (drops keyboards, pencils, stands as configured)
   - removes the Apple logo and anything else listed under `remove`
   - turns it to the app's convention: metres, screen facing +Z, top at +Y,
     centred (handhelds) or standing on y = 0 (displays)
   - names the display mesh "screen", gives it plain 0–1 UVs across the
     panel and a blank material — the app puts footage there
   - tags the parts that carry the product colour (`finish`), so the app
     can recolour them
   - merges, deduplicates and compresses the result: WebP textures,
     EXT_meshopt_compression geometry

   `--debug` writes the turned, trimmed model with its part names intact to
   public/_test/ for inspection. `--list` prints every mesh in the device's final frame — name, material,
   colour, size, position — which is how the lists below were worked out.
   ===================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsSpecular } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, meshopt, simplifyPrimitive, textureCompress, transformMesh, transformPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'Models');
const OUT = path.join(ROOT, 'public', 'models');

/* Nodes are named, or given by index where a file's names are garbled or
   repeated (indices are as --list and a glTF viewer show them).
   keep:    node index of the device's own subtree (when the file holds more)
   screen:  the display mesh — or a list of meshes, for a display modelled in
            pieces (a foldable's inner screen, one per half)
   cover:   a second display, on the back (an open foldable's cover screen):
            named "cover", with its own UVs, so it can show footage too
   camera:  a rear-camera part — fixes which way is up
   upAxis:  'long' (portrait handhelds) or 'short' (displays, and handhelds
            whose screen is wider than tall, with handheld: true)
   depth:   body thickness in mm, to centre the body on z = 0
   remove:  node names to delete (logos, accessories)
   finish:  material names that carry the product colour
   width:   true body width in mm, for downloads in arbitrary units — the
            model is scaled uniformly to match
   scale:   or a fixed factor to metres (both states of a foldable alike)
   hinge:   a part that pivots: { kind, part: node index (or stand: names
            of the parts that stay put), pivot: node name or 'auto' }. kind
            'lid' (a laptop's; 'auto' solves the hinge line) or 'tilt' (a
            display panel, turning about its stand's hinge part). The part is stood
            upright in its own node, "hinge", placed on the pivot line, so
            the app can turn it about x. Models with a hinge keep the
            source's up direction rather than taking it from the screen.
   reassign: [{ node, to, zBelow }] — move a part's triangles lying behind
            z = zBelow (mm, final frame) to another material: for a logo that
            is the same mesh as something else, so can't be deleted
   outward: true — turn the right way out any part whose faces mostly point
            into the device (some exports rely on double-sided materials)
   finish2: materials carrying a model's second tone (an iMac's pale front)
   simplify: { ratio, error, materials } — thin out dense geometry, only on
            parts with these materials (shading on hard-surface parts suffers);
            error is relative to each mesh's size
   screenRect: [w, h] in mm — when the display mesh covers the whole front,
            bezel included, a new screen of this size replaces it as the
            footage surface and the old one becomes black glass
   fold:    an open foldable that can be part-folded: 'vertical' (a book —
            the right half turns) or 'horizontal' (a flip — the top half
            turns). Every part is split at the crease; the turning half goes
            on a node "fold" on the hinge line, at the inner screen's face
            (the halves fold screen to screen). Its extras say which axis it
            turns about and which way is closing.
   retired: true — no longer in the app; built only when named */
export const CONFIG = {
  'studio-display': {
    src: 'apple_mac_studio_system_2023',
    keep: 95,                                   // the display alone: not the Mac Studio, keyboard or mouse
    screen: 'FwsgVgUBhzMnemQ', upAxis: 'short', depth: 30,
    hinge: {
      kind: 'tilt', pivot: 'oXVOitakfyATofw',   // the stand's hinge barrel
      stand: ['QlyBgaedCbVqLcR', 'AJfMMjVHlAxPJeu', 'IvGkEVtgMQISLCv', 'yyyVtsqeutRZkfQ', 'oXVOitakfyATofw',
        'BQtMDvfOKhQLmke', 'xnuoJRRbdyFpNQg', 'ZDXyAuiHuAVymlQ'],   // stand, foot, hinge, power cable
    },
    remove: ['QXxWbTMOHehsLQJ'],                // Apple logo on the back
    finish: ['wLCksItDljqrCUH', 'kQveFrwBlkJHpbc', 'ouyAkRMbGtaVsmr'],   // aluminium: stand, panel shell
  },
  'imac-24': {
    outward: true,
    src: 'imac_2021',
    width: 547,                                 // the download is in arbitrary units
    screen: 'Screen_Screen_0', upAxis: 'short', depth: 11.5,
    hinge: { kind: 'tilt', part: 5, pivot: 'Rotate_Metal_0' },   // its own "Rotate" group, on the hinge barrel
    remove: [],
    reassign: [{ node: 'Screen_LightBlue_0', to: 'DarkBlue', zBelow: 9 }],   // the Apple logo on the back
    finish: ['DarkBlue'],                       // the back
    finish2: ['LightBlue'],                     // the pale front and stand
  },
  'ipad-mini': {
    outward: true,
    src: 'ipad_mini_6_2021',
    width: 134.8,
    screen: 'iPad Mini_Screen_0', camera: 'iPad Mini_Cam1_0', upAxis: 'long', depth: 6.3,
    remove: ['iPad Mini_BaseColorLogo_0'],      // Apple logo and "iPad" on the back
    finish: ['BaseColor', 'BaseColorMatte'],
  },
  'pixel-6-pro': {
    outward: true,
    src: 'google_pixel_6_pro',
    width: 75.9,
    screen: 'Screen_Screen_0', camera: 'CircleCam', upAxis: 'long', depth: 8.9,
    remove: ['BackBody..001_Logo_0'],           // Google "G"
    finish: ['BackBottom', 'Frame', 'Antennas'],
    finish2: ['Backtop'],                       // the band above the camera bar is a second tone
  },
  // replaced by the S26 Ultra and Z Flip7; kept should they need to come back
  'galaxy-s21-ultra': {
    retired: true,
    outward: true,
    src: 'samsung_galaxy_s21_ultra',
    width: 75.6,
    screen: 'Screen_Screen_0', camera: 'Camera1', upAxis: 'long', depth: 8.9,
    remove: ['Logo_BodyFrame_0'],               // "SAMSUNG"
    finish: ['BodyFrame', 'Back'],
  },
  'galaxy-z-flip-3': {
    retired: true,
    outward: true,
    src: 'samsung_galaxy_z_flip_3',
    width: 72.2,
    screen: 'Z Flip 3_Screen_0', camera: 'Camera_CameraMetal_0', upAxis: 'long', depth: 6.9,
    remove: [],
    finish: ['back', 'metal'],                  // the lower back and frame; the cover-screen half stays black
  },
  /* zhe_kan's models: true size, in metres (the Duo in decimetres, scaled to
     Apple's figures). Each file
     holds the phone twice, or a foldable open and closed. The glass over the
     active screen goes: it's a 25% white veil that would wash out footage
     (the app's screen material does its own glare). */
  'galaxy-s26': {
    src: 'samsung_galaxy_s26',
    keep: 3,                                    // the copy facing front
    screen: 'Object_20', camera: 32, upAxis: 'long', depth: 7.2,   // rear cameras (garbled name)
    remove: ['samsung-1-logo_5', 'Object_11'],  // "SAMSUNG"; screen glass
    finish: ['Frame_Cobalt_Violet', 'Glass_back', 'Glass_back.001'],   // frame, back, camera surround
  },
  'galaxy-s26-ultra': {
    src: 'samsung_galaxy_s26_ultra',
    keep: 55,                                   // the copy with its S Pen docked
    screen: 'Object_98', camera: 'Camera.007_26', upAxis: 'long', depth: 7.9,
    remove: ['samsung-1-logo.002_35', 'Object_91', 'Cylinder.003_27'],   // logo; screen glass; a part sealed inside
    finish: ['Frame_Sky_Blue', 'Frame_Sky_Blue.001', 'Glass_back', 'Glass_back.001'],
  },
  'galaxy-z-flip-7': {
    src: 'samsung_galaxy_z_flip_7',
    keep: 3,                                    // open
    screen: 'Object_37', cover: 'Object_40', fold: 'horizontal',   // the cover screen, on the back
    camera: 'Camera.001_2', upAxis: 'long', depth: 6.5,
    remove: ['Object_16', 'Object_35'],         // the glass over each screen
    finish: ['Frame_Sky_Blue', 'Frame_Sky_Blue.001', 'Glass_back'],   // named blue, modelled Coral Red
  },
  'galaxy-z-flip-7-closed': {
    src: 'samsung_galaxy_z_flip_7',
    keep: 49,                                   // closed: the cover screen is the display
    screen: 'Object_97', camera: 'Camera.003_28', upAxis: 'long', depth: 13.7,
    remove: ['Object_95', 'Object_67', 'Object_100'],   // cover glass; the inner screen, folded away
    finish: ['Frame_Sky_Blue', 'Frame_Sky_Blue.001', 'Glass_back'],
  },
  'galaxy-z-fold-8': {
    src: 'samsung_galaxy_z_fold8',
    keep: 3,                                    // open: wider than tall
    screen: ['Object_50', 'Object_56'], cover: 'Object_22', fold: 'vertical',   // inner screen, a piece per half; cover screen
    camera: 'Camera.007_4', upAxis: 'short', handheld: true, depth: 4.9,
    remove: ['samsung-1-logo_16', 'Object_47', 'Object_53', 'Object_27'],  // logo on the spine; screen glass
    finish: ['Frame_Lavender', 'Frame_Lavender.001', 'Glass_back'],
  },
  'galaxy-z-fold-8-closed': {
    src: 'samsung_galaxy_z_fold8',
    keep: 61,
    screen: 'Object_89', camera: 'Camera.001_27', upAxis: 'long', depth: 9.7,
    remove: ['samsung-1-logo.001_32', 'Object_78', 'Object_108', 'Object_114'],
    finish: ['Frame_Lavender', 'Frame_Lavender.001', 'Glass_back'],
  },
  'iphone-duo': {
    src: 'apple_iphone_duo',
    keep: 44, width: 164.6,                     // open, like a book: wider than tall
    screen: 'Object_77', cover: 'Object_80', fold: 'vertical', camera: 'Camera_18', upAxis: 'short', handheld: true, depth: 5.2,
    remove: ['Apple logo_16', 'Object_72', 'Object_83'],
    finish: ['Frame_Night_Sky', 'Glass_back'],
  },
  'iphone-duo-closed': {
    src: 'apple_iphone_duo',
    keep: 3, width: 84.1,
    screen: 'Object_24', camera: 'Camera.001_2', upAxis: 'long', depth: 11.3,
    remove: ['Apple logo.001_0', 'Object_27'],
    finish: ['Frame_Night_Sky', 'Glass_back'],
  },
  // laptops: the lid group pivots; 'auto' solves the hinge line from the lid
  // as modelled and closed flat on the base
  'macbook-pro-14': {
    src: '2021_macbook_pro_14_m1_pro__m1_max',
    screen: 'abgVijaHVNRUvcc', upAxis: 'short', depth: 15.5,
    hinge: { kind: 'lid', part: 3, pivot: 'auto' },
    remove: ['FnbkdmFKVeCCxTX', 'YJMoQnvBNpTrgeH'],                  // Apple logo, "MacBook Pro" underneath
    finish: [                                                       // lid, base, trackpad, inner edges
      'zqeFZcIteZtOShc', 'hPcehRUjcLAosED', 'pZbDFXVUkfRwjmQ', 'LJSCtLIrHNHZnIH', 'BMKLbAPYqPmfArt', 'VqwNZwmDotIMflD',
      'SKOFticEGTqECbB', 'yVmFXNTCIwNkqVT', 'HpEeGHRuOqfcIZU',                            // speaker grilles, hinge cover, underside
    ],
  },
  'macbook-pro-16': {
    src: '2021_macbook_pro_16_m1_pro__m1_max',
    screen: 'ZjoauFcgUEryaFv', upAxis: 'short', depth: 16.8,
    hinge: { kind: 'lid', part: 43, pivot: 'auto' },
    remove: ['rUfHNUxnPMwlQpL', 'wjEMxyUPtliZPgO'],
    // the speaker grilles come with their dimples (a normal map) but not the
    // holes: without them they're flat matte panels. The 14" has the same
    // grille, holes and all.
    borrow: { BJHFryDpfLTrIUR: ['2021_macbook_pro_14_m1_pro__m1_max', 'SKOFticEGTqECbB_baseColor.png'] },
    finish: [
      'jbymIibDBIQtwZE', 'FwYAzsKABqWllcM', 'BBhHSfAMszYERPV', 'BkRYbrCAclpJGRH', 'NsCaZzFJpuLtwrq',
      'BJHFryDpfLTrIUR', 'GtAvbYKPuqBjPEW', 'dfDUQnlzgXnXaEi',
    ],
  },
  'macbook-air-13': {
    src: 'apple_macbook_air_13_space_gray_2023',
    screen: 'obRdEiGZsRMTwyW', upAxis: 'short', depth: 11.3,
    hinge: { kind: 'lid', part: 8, pivot: 'auto' },
    remove: ['XjgQCJbVkrQkOsQ', 'fkbfpjBhNMhfzDW'],               // Apple logo; an inner shell spanning lid and base
    finish: ['EkhjlGXoFUXMyOy', 'KytEEzFODqdHQGL', 'FBLQMCszsqVEtaM', 'oxmVaqGZOBDavYi', 'DCrAlAHJnwmXxnL'],
  },
  'macbook-air-15': {
    src: 'apple_macbook_air_15_space_gray_2023',
    screen: 'SadnAkehSlxIwKv', upAxis: 'short', depth: 11.5,
    hinge: { kind: 'lid', part: 6, pivot: 'auto' },
    remove: ['OrhpMXCxeprcNok'],
    finish: [
      'pEUnNAGXCoAFoUk', 'zFJMMvikHFjtmzd', 'hZBlDyddxAQhuPm', 'JKvAHnqjqlqshmY', 'AvocVUvikCzzMtu', 'YjmXmicdBWsFQyD',
    ],
  },
  'watch-series-9': {
    src: 'apple_watch_series_9',
    screen: 'rpqLEPlKpASApqb', upAxis: 'long', depth: 10.7,
    remove: [],
    finish: [
      'aCVlZUUJessOAmj', 'PZwnCJKCTXwOgoC', 'SeEAkscyjakjLvk', 'ntlIOkEgKDxSUZR',   // case, crown, band lugs
      'HjPidnwCAHrpaJz', 'QkcshUzBIohvwjY',                                         // Sport Band, matched to the case
    ],
  },
  'watch-ultra-2': {
    src: 'apple_watch_ultra_2',
    screen: 'VHnHbLOyhEXLvWA', upAxis: 'long', depth: 14.4,
    // the woven Trail Loop is most of the geometry; the case stays untouched
    simplify: { ratio: 0.5, error: 0.001, materials: ['sTxeXXVKohXeDJU', 'lgIBGhMXHpTEcfq', 'FsJfKVbzNLXJeBa'] },
    remove: [],
    finish: [                                                       // titanium case, bezel, crown, buttons
      'edhWAPEBZsqCLTg', 'LMTUXYhSYYJrnsy_0', 'GXPSJdzybTrBefY', 'YtajTVWccmKRZBL',
      'GvXrALMIeaGmIJo', 'KjETpDnldvdbNBw', 'vqobCvtAVyNLbeh', 'PmrTDgoSkxCPUel', 'CdZJpyOXLDMygZg',
    ],
  },
  'pro-display-xdr': {
    src: 'apple_pro_display_xdr',
    screen: 'IyklIWCEUuwKzOr', upAxis: 'short', depth: 27,
    screenRect: [700.9, 394.3],                 // 6016 × 3384 at 218 ppi
    remove: [],                                 // its logo is cut through the shell; it stays
    finish: ['MSkMQXmvZdOsszM', 'nssRtVtXVzpjuEl', 'CxxRfrqFwbeSPbx', 'jvJBYyOCabObecq'],   // shell and stand, lattice, hinge
  },
  'iphone-15-pro': {
    src: 'apple_iphone_15_pro_natural',
    screen: 'OPyTWluDoHpcqDg', camera: 'SKhOmAlkMLLLqdh', upAxis: 'long', depth: 8.25,
    remove: ['rRozuaOxDcRzgjz', 'jQUAtUkpsKXTgyJ'],                  // Apple logo (inlay + rim)
    finish: [
      'FQlpQptfKGrunTO', 'RDNOdOPVQvTgeqz', 'zkrUUbwMQYGjtZC', 'GMvEaOJMMRleZki',   // frame, back glass, glass backing, camera plateau
      'srCWZnaCWyCMyfw', 'XoIfxoPbmzOsPTz', 'pOCZJMRSJAQnXBy', 'AoOjIpLLnihuFiD',   // inner rail, port surround, antenna bands, buttons
      'qNCLfZgrmjqteJo', 'ooCzKfoOOkqkLCn', 'iZDyFqwtPeSRVqm', 'sOpMJlQbXbAoPZR',   // port, side button, lens rings
      'yNEhaPUBweksCuE', 'JBSbqlzFkPrNKJO', 'yscemEsYrhaqtFv', 'NhLXaXdMrDMcdiE',   // lens housings, mic, flash surround
    ],
  },
  // same construction as the 15 Pro; material names differ per file
  'iphone-15-pro-max': {
    src: 'apple_iphone_15_pro_max_natural',
    screen: 'xuumQFYYicplRrq', camera: 'GiCuhyFhjrrLLSr', upAxis: 'long', depth: 8.25,
    remove: ['MMpbtXmvfJyVhPr', 'tdleFRArrbIItBw'],
    finish: [
      'MqwllfjVhYTDZVf', 'vAaNoDQTrEBclaz', 'onzFRShBVhsOiEg', 'UFaqUycbMtOQPdK',
      'YNDEqeFFBWSLxra', 'fHRpswqGpnjFcrg', 'TTzUbWJELeRTanQ', 'JWFwAzamSgOroWv',
      'frdgUMZdCzqJsgo', 'jRMvbcmmtOtYqlN', 'noNFPELbhcgbQcA', 'bHkmQhTxlErxgQC',
      'gEblDuiiduyFePX', 'DKgZHBeLmSjWJzv', 'axTBsZToZNbqDoq',
    ],
  },
  'ipad-pro-11': {
    src: 'ipad_pro_11in_silver_4gen',
    keep: 36,                                   // the iPad alone, not the Magic Keyboard (3)
    screen: 'PRAXDcFseEWijoQ', camera: 'wlhnhtLXUZJHBSo', upAxis: 'long', depth: 5.9,
    remove: ['VBCfWGfKEQusHhL', 'bDTcKQywjNpZYpT'],                  // Apple logo, "iPad Pro" wordmark
    finish: [
      'ewmqzVwtzdlFwie', 'NkSkziupJniNADU', 'igRXfhTXAhfiiMS',      // housing, Smart Connector, antenna band
      'AZAnuWesJCbQYPb', 'ePSCJAFDGtxbJlh', 'CTpVpQykWSQrwjg',     // Pencil charging strip
    ],
  },
  'ipad-pro-13': {
    src: 'ipad_pro_13in_silver_m4',
    keep: 37,                                   // the iPad alone: not the Magic Keyboard (8) or Pencil (2)
    screen: 'EjCaatfcGdAQBho', camera: 'JIouNTotQkoXojU', upAxis: 'long', depth: 5.1,
    remove: ['zOxbcmrLkjhpczv', 'zqtoVbRomYTqSHh'],                  // Apple logo, "iPad Pro" wordmark
    finish: [
      'rlLxXLyqFuSJzQX', 'JiwoEoDQOLnLqCc', 'AtpoqQwyXHyfcDR',     // housing, Smart Connector
      'jKxlebhoFEjFmnf', 'qNcPOaKIPnbkQEP', 'FrqgcMaoWnXCxPQ',     // Pencil charging strip
      'hHkyTAHrTokEUgD', 'wADiXiaDqUQHYtm',                         // camera ring, antenna band
    ],
  },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const v3 = () => new THREE.Vector3();
const mat4 = (arr) => new THREE.Matrix4().fromArray(arr);

/** Every triangle-mesh primitive under `node`, with its world matrix. */
function primitivesUnder(node) {
  const out = [];
  node.traverse((n) => {
    const mesh = n.getMesh();
    if (!mesh) return;
    const w = mat4(n.getWorldMatrix());
    for (const p of mesh.listPrimitives()) if (p.getMode() === 4) out.push({ node: n, prim: p, world: w });
  });
  return out;
}

function forEachVertex({ prim, world }, fn) {
  const pos = prim.getAttribute('POSITION');
  const e = [0, 0, 0], v = v3();
  for (let i = 0; i < pos.getCount(); i++) fn(v.fromArray(pos.getElement(i, e)).applyMatrix4(world), i);
}

function forEachTriangle({ prim, world }, fn) {
  const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
  const n = idx ? idx.getCount() : pos.getCount();
  const e = [0, 0, 0], a = v3(), b = v3(), c = v3();
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx.getScalar(i) : i, ib = idx ? idx.getScalar(i + 1) : i + 1, ic = idx ? idx.getScalar(i + 2) : i + 2;
    a.fromArray(pos.getElement(ia, e)).applyMatrix4(world);
    b.fromArray(pos.getElement(ib, e)).applyMatrix4(world);
    c.fromArray(pos.getElement(ic, e)).applyMatrix4(world);
    fn(a, b, c);
  }
}

/** A node by name, or by index. */
function findNode(nodes, ref, what) {
  const n = typeof ref === 'number' ? nodes[ref] : nodes.find((x) => x.getName() === ref);
  if (!n) throw new Error(`${what} node ${ref} not found`);
  return n;
}

/** Black, low-reflectance glass, like the app's own device glass: a display
    that's switched off. */
function blackGlass(doc) {
  const spec = doc.createExtension(KHRMaterialsSpecular).createSpecular().setSpecularFactor(0.07);
  return doc.createMaterial('panel-glass').setBaseColorFactor([0.004, 0.004, 0.004, 1])
    .setMetallicFactor(0).setRoughnessFactor(0.32).setExtension('KHR_materials_specular', spec);
}

const isAncestor = (a, n) => { for (let x = n?.getParentNode(); x; x = x.getParentNode()) if (x === a) return true; return false; };

/** Move every mesh node below `parent` to be its direct child, keeping where it is. */
function flattenInto(parent) {
  const inv = new THREE.Matrix4().fromArray(parent.getWorldMatrix()).invert();
  const meshes = [];
  parent.traverse((n) => { if (n !== parent && n.getMesh()) meshes.push(n); });
  // every placement first: detaching one node changes its descendants' world matrices
  const locals = meshes.map((n) => inv.clone().multiply(new THREE.Matrix4().fromArray(n.getWorldMatrix())));
  meshes.forEach((n, i) => {
    for (const c of n.listChildren()) n.removeChild(c);   // mesh children are in the list themselves
    n.getParentNode()?.removeChild(n);
    n.setMatrix(locals[i].toArray());
    parent.addChild(n);
  });
}

function centroid(prims) {
  const box = new THREE.Box3();
  for (const p of prims) forEachVertex(p, (v) => box.expandByPoint(v));
  return box.getCenter(v3());
}

/** Rotation taking the source frame to the app's: screen normal → +Z, top → +Y. */
function canonicalFrame(cfg, keep, screenNode, camNode) {
  const all = primitivesUnder(keep);
  const scr = primitivesUnder(screenNode);

  // area-weighted normal of the display
  const n = v3(), ab = v3(), ac = v3(), cr = v3();
  for (const p of scr) forEachTriangle(p, (a, b, c) => { n.add(cr.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))); });
  n.normalize();
  const sc = centroid(scr), bc = centroid(all);
  // the screen faces away from the body — except a laptop's, which faces its keyboard
  if ((n.dot(v3().subVectors(sc, bc)) < 0) !== (cfg.hinge?.kind === 'lid')) n.negate();

  /* in-plane axes of the display: principal directions of its area. Area,
     not vertices — rounded corners crowd vertices together, and a screen in
     two halves has most of them along its outline, where they can make a
     wide panel look square. A triangle's second moment is
     A/12 · (Σ vᵢvᵢᵀ + (Σ vᵢ)(Σ vᵢ)ᵀ). */
  const t1 = Math.abs(n.y) < 0.9 ? v3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize() : v3().crossVectors(n, new THREE.Vector3(1, 0, 0)).normalize();
  const t2 = v3().crossVectors(n, t1);
  let sxx = 0, syy = 0, sxy = 0;
  const d = v3();
  const flat = (v) => { d.subVectors(v, sc); return [d.dot(t1), d.dot(t2)]; };
  for (const p of scr) forEachTriangle(p, (a, b, c) => {
    const area = cr.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).length() / 2;
    const vs = [a, b, c].map(flat);
    const [sx, sy] = [vs[0][0] + vs[1][0] + vs[2][0], vs[0][1] + vs[1][1] + vs[2][1]];
    let xx = sx * sx, yy = sy * sy, xy = sx * sy;
    for (const [x, y] of vs) { xx += x * x; yy += y * y; xy += x * y; }
    sxx += area * xx / 12; syy += area * yy / 12; sxy += area * xy / 12;
  });
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);             // major axis angle in the (t1, t2) plane
  const major = v3().addScaledVector(t1, Math.cos(ang)).addScaledVector(t2, Math.sin(ang)).normalize();
  const minor = v3().crossVectors(n, major).normalize();
  let up = cfg.upAxis === 'short' ? minor : major;

  // which end is the top: the rear camera's, or the world's up
  if (camNode) {
    if (up.dot(v3().subVectors(centroid(primitivesUnder(camNode)), sc)) < 0) up.negate();
  } else if (up.y < 0) up.negate();

  const X = v3().crossVectors(up, n).normalize();
  const Y = up.clone(), Z = n.clone();
  // rows X, Y, Z: world → canonical
  const R = new THREE.Matrix4().set(
    X.x, X.y, X.z, 0,
    Y.x, Y.y, Y.z, 0,
    Z.x, Z.y, Z.z, 0,
    0, 0, 0, 1,
  );
  return { R, normal: n };
}

async function prepare(id, { list = false, debug = false } = {}) {
  const cfg = CONFIG[id];
  const dir = path.join(SRC, cfg.src);
  const doc = await io.read(path.join(dir, 'scene.gltf'));
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const nodes = root.listNodes();

  // 1. the device subtree(s), with their parents' transforms baked in
  const keep = cfg.keep != null ? [nodes[cfg.keep]] : scene.listChildren();
  const device = doc.createNode('device');
  for (const k of keep) {
    const w = k.getWorldMatrix();
    k.getParentNode()?.removeChild(k);
    scene.removeChild(k);
    k.setMatrix(w);
    device.addChild(k);
  }
  for (const c of scene.listChildren()) scene.removeChild(c);
  scene.addChild(device);

  // 2. delete logos and accessories
  for (const ref of cfg.remove || []) findNode(nodes, ref, `${id}: removed`).dispose();

  // a display in pieces becomes one mesh, in the first piece's frame
  const [screenRef, ...pieces] = [cfg.screen].flat();
  let screenNode = findNode(nodes, screenRef, `${id}: screen`);
  const toScreen = new THREE.Matrix4().fromArray(screenNode.getWorldMatrix()).invert();
  for (const ref of pieces) {
    const n = findNode(nodes, ref, `${id}: screen`);
    const m = toScreen.clone().multiply(new THREE.Matrix4().fromArray(n.getWorldMatrix()));
    for (const p of n.getMesh().listPrimitives()) {
      const copy = p.clone().setIndices(p.getIndices()?.clone() ?? null);
      for (const sem of copy.listSemantics()) copy.setAttribute(sem, copy.getAttribute(sem).clone());
      transformPrimitive(copy, m.toArray());
      screenNode.getMesh().addPrimitive(copy);
    }
    n.dispose();
  }
  const camNode = cfg.camera != null ? findNode(nodes, cfg.camera, `${id}: camera`) : null;

  const coverNode = cfg.cover != null ? findNode(nodes, cfg.cover, `${id}: cover`) : null;

  // 3. turn, scale and centre
  let { R, normal } = canonicalFrame(cfg, device, screenNode, camNode);
  let hingeSet = null, phi = 0, pivot = null;
  if (cfg.hinge) {
    // keep the source's up; face the screen's horizontal direction to +Z
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(normal.x, 0, normal.z).normalize();
    const X = v3().crossVectors(Y, Z);
    R = new THREE.Matrix4().set(X.x, X.y, X.z, 0, Y.x, Y.y, Y.z, 0, Z.x, Z.y, Z.z, 0, 0, 0, 0, 1);
    phi = Math.atan2(normal.dot(Y), normal.dot(Z));            // how far the panel leans back
  }
  if (cfg.scale) R.premultiply(new THREE.Matrix4().makeScale(cfg.scale, cfg.scale, cfg.scale));
  if (cfg.width) {
    device.setMatrix(R.toArray());
    const b = new THREE.Box3();
    for (const p of primitivesUnder(device)) forEachVertex(p, (v) => b.expandByPoint(v));
    R.premultiply(new THREE.Matrix4().makeScale(...Array(3).fill(cfg.width / 1000 / b.getSize(v3()).x)));
  }
  device.setMatrix(R.toArray());

  if (cfg.hinge) {
    // the moving part: one node's subtree, or every mesh but the named stand parts
    hingeSet = cfg.hinge.stand
      ? new Set(primitivesUnder(device).map((p) => p.node).filter((n) => !cfg.hinge.stand.includes(n.getName())))
      : new Set([nodes[cfg.hinge.part]]);
    const partPrims = [...hingeSet].flatMap(primitivesUnder);
    if (cfg.hinge.pivot === 'auto') {
      /* A lid's hinge line is wherever a single rotation takes the lid as
         modelled to the lid closed: screen face resting on the base's top
         (a hair clear of it), far edge flush with the base's front edge —
         the edge everyone sees. O: the screen face's top edge now; C: where
         it lands when closed. Solve C − p = Rot(θ)(O − p) for p. */
      const n2 = new THREE.Vector2(Math.sin(phi), Math.cos(phi));    // screen normal, in (y, z)
      const u2 = new THREE.Vector2(Math.cos(phi), -Math.sin(phi));   // the lid's up
      let hi = -Infinity, lo = Infinity, face = -Infinity;
      for (const p of partPrims) forEachVertex(p, (v) => { const t = v.y * u2.x + v.z * u2.y; hi = Math.max(hi, t); lo = Math.min(lo, t); });
      // the face the lid closes onto, measured above the hinge end: the hinge
      // cover and the shell's curl around it stand several mm proud of the glass
      for (const p of partPrims) forEachVertex(p, (v) => {
        if (v.y * u2.x + v.z * u2.y > lo + (hi - lo) * 0.2) face = Math.max(face, v.y * n2.x + v.z * n2.y);
      });
      const O = u2.clone().multiplyScalar(hi).add(n2.clone().multiplyScalar(face));
      // the rest height is the deck at the palm rest: keycaps and the hinge
      // housing stand proud of it in these models and would hold the lid off
      const basePrims = primitivesUnder(device).filter((p) => !hingeSet.has(p.node) && ![...hingeSet].some((h) => isAncestor(h, p.node)));
      let front = -Infinity, back = Infinity;
      for (const p of basePrims) forEachVertex(p, (v) => { front = Math.max(front, v.z); back = Math.min(back, v.z); });
      let top = -Infinity;
      for (const p of basePrims) forEachVertex(p, (v) => { if (v.z > front - (front - back) * 0.15) top = Math.max(top, v.y); });
      const C = new THREE.Vector2(top + 0.0002, front);
      const a = Math.PI / 2 + phi;                                   // as modelled → closed
      const cos = Math.cos(a), sin = Math.sin(a);
      const ro = new THREE.Vector2(O.x * cos - O.y * sin, O.x * sin + O.y * cos);
      // (I − Rot) p = C − Rot·O
      const m00 = 1 - cos, m01 = sin, m10 = -sin, m11 = 1 - cos, det = m00 * m11 - m01 * m10;
      const bx = C.x - ro.x, by = C.y - ro.y;
      const py = (bx * m11 - m01 * by) / det, pz = (m00 * by - m10 * bx) / det;
      pivot = new THREE.Vector3(0, py, pz);
    } else {
      pivot = centroid(primitivesUnder(findNode(nodes, cfg.hinge.pivot, `${id}: pivot`)));
    }
  }
  // stand the hinged part upright about the pivot line
  const upright = cfg.hinge
    ? new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(new THREE.Matrix4().makeRotationX(phi))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
    : null;
  const inHinge = (node) => { for (let n = node; n; n = n.getParentNode()) if (hingeSet?.has(n)) return true; return false; };

  const box = new THREE.Box3();
  for (const p of primitivesUnder(device)) forEachVertex(p, (v) => box.expandByPoint(upright && inHinge(p.node) ? v.applyMatrix4(upright) : v));
  const size = box.getSize(v3());
  const off = (cfg.upAxis === 'short' && !cfg.handheld) || cfg.hinge
    ? new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
    : new THREE.Vector3(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.max.z - (cfg.depth / 1000) / 2));
  const M = new THREE.Matrix4().makeTranslation(off.x, off.y, off.z).multiply(R);
  device.setMatrix(M.toArray());

  let hingeNode = null;
  if (cfg.hinge) {
    // a node on the pivot line holds the upright part; turning it about x opens or tilts it
    hingeNode = doc.createNode('hinge').setTranslation([pivot.x + off.x, pivot.y + off.y, pivot.z + off.z]);
    const toLocal = new THREE.Matrix4().makeRotationX(phi)
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)).multiply(R);
    for (const k of hingeSet) {
      const w = new THREE.Matrix4().fromArray(k.getWorldMatrix());   // under device: M · local
      const local = toLocal.clone().multiply(new THREE.Matrix4().copy(M).invert().multiply(w));
      k.getParentNode()?.removeChild(k);
      k.setMatrix(local.toArray());
      hingeNode.addChild(k);
    }
    scene.addChild(hingeNode);
  }

  if (list) { listMeshes(device, size); if (hingeNode) { console.log('-- hinge --'); listMeshes(hingeNode, size); } return; }
  if (debug) {   // turned and trimmed, names intact: for looking at parts in a viewer
    await doc.transform(prune());
    const file = path.join(ROOT, 'public', '_test', `debug-${id}.glb`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await io.write(file, doc);
    return console.log(`wrote ${path.relative(ROOT, file)}`);
  }

  // 3b. triangles behind a plane move to another material (a logo that's part of a bigger mesh)
  for (const r of cfg.reassign || []) {
    const node = findNode(nodes, r.node, `${id}: reassign`);
    const to = root.listMaterials().find((m) => m.getName() === r.to);
    if (!to) throw new Error(`${id}: reassign material ${r.to} not found`);
    for (const p of primitivesUnder(node)) {
      const idx = p.prim.getIndices();
      const keep = [], move = [];
      let t = 0;
      forEachTriangle(p, (a, b, c) => {
        const tri = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
        ((a.z + b.z + c.z) / 3 < r.zBelow / 1000 ? move : keep).push(...tri);
        t += 3;
      });
      if (!move.length) continue;
      const buf = root.listBuffers()[0];
      const mk = (arr) => doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint32Array(arr));
      p.prim.setIndices(mk(keep));
      const moved = p.prim.clone().setIndices(mk(move)).setMaterial(to);
      // own copies of the vertex data, so later transforms don't apply twice
      for (const sem of moved.listSemantics()) moved.setAttribute(sem, moved.getAttribute(sem).clone());
      node.getMesh().addPrimitive(moved);
    }
  }

  // 3c. mirrored parts (FBX exports often carry a negative scale) get their
  //     transform baked into the geometry, winding reversed, so nothing
  //     renders inside out
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    const world = new THREE.Matrix4().fromArray(n.getWorldMatrix());
    if (!mesh || world.determinant() >= 0) continue;
    const own = mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1 ? mesh.clone() : mesh;
    transformMesh(own, world.toArray());
    n.setMesh(own);
    const parent = n.getParentNode();
    const parentWorld = parent ? new THREE.Matrix4().fromArray(parent.getWorldMatrix()) : new THREE.Matrix4();
    n.setMatrix(parentWorld.invert().toArray());   // world becomes identity
  }

  // 3d. parts modelled inside out: faces (and normals) mostly pointing at the
  //     device's middle get flipped, so single-sided rendering shows them
  if (cfg.outward) {
    const all = primitivesUnder(scene);
    const mid = new THREE.Box3();
    for (const p of all) forEachVertex(p, (v) => mid.expandByPoint(v));
    const c = mid.getCenter(v3()), ab = v3(), ac = v3(), n = v3(), ctr = v3();
    for (const p of all) {
      let signed = 0, total = 0;
      forEachTriangle(p, (a, b, cc) => {
        n.crossVectors(ab.subVectors(b, a), ac.subVectors(cc, a));       // length = 2 × area
        ctr.copy(a).add(b).add(cc).divideScalar(3).sub(c).normalize();
        const d = n.dot(ctr);
        signed += d; total += Math.abs(d);
      });
      if (total === 0 || signed / total > -0.3) continue;
      const idx = p.prim.getIndices();
      const arr = idx.getArray().slice();
      for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
      idx.setArray(arr);
      const nrm = p.prim.getAttribute('NORMAL');
      if (nrm) { const na = nrm.getArray().slice(); for (let i = 0; i < na.length; i++) na[i] = -na[i]; nrm.setArray(na); }
    }
  }

  // 3e. textures a download lacks, taken from a sibling model's: a material
  // gets the other's base colour (and its alpha, so it blends)
  for (const [name, [folder, file]] of Object.entries(cfg.borrow || {})) {
    const m = root.listMaterials().find((x) => x.getName() === name);
    if (!m) throw new Error(`${id}: borrow: material ${name} not found`);
    const tex = doc.createTexture(file).setImage(fs.readFileSync(path.join(SRC, folder, 'textures', file))).setMimeType('image/png');
    m.setBaseColorTexture(tex).setAlphaMode('BLEND');
  }

  // 4. tag the colour-carrying materials
  const finish = new Set(cfg.finish || []), finish2 = new Set(cfg.finish2 || []);
  for (const m of root.listMaterials()) {
    const role = finish.has(m.getName()) ? 1 : finish2.has(m.getName()) ? 2 : 0;
    if (!role) continue;
    // a texture's average colour (linear), so the app can set a part to an exact colour
    let texMean = null;
    const tex = m.getBaseColorTexture();
    if (tex) {
      const { channels } = await sharp(Buffer.from(tex.getImage())).stats();
      const rgb = channels.length >= 3 ? channels.slice(0, 3) : [channels[0], channels[0], channels[0]];   // grey (+ alpha) textures
      texMean = rgb.map((c) => Math.pow((c.mean / 255 + 0.055) / 1.055, 2.4));
    }
    m.setExtras({ ...m.getExtras(), finish: role === 2 ? 2 : true, ...(texMean ? { texMean } : {}) });
  }
  const missing = [...finish, ...finish2].filter((n) => !root.listMaterials().some((m) => m.getName() === n));
  if (missing.length) throw new Error(`${id}: finish materials not found: ${missing.join(', ')}`);

  // 5. merge everything that can be, keeping the screens separate
  for (const n of root.listNodes()) if (n !== screenNode && n !== coverNode && n !== device && n !== hingeNode) n.setName('');
  for (const m of root.listMeshes()) m.setName('');
  screenNode.setName('screen');
  screenNode.getMesh().setName('screen');
  coverNode?.setName('cover');
  coverNode?.getMesh().setName('cover');
  if (hingeNode) {
    // flatten within each moving part, so the hinge keeps its children
    flattenInto(device);
    flattenInto(hingeNode);
    await doc.transform(join({ keepNamed: true }), dedup(), prune());
  } else {
    await doc.transform(flatten(), join({ keepNamed: true }), dedup(), prune());
  }

  // 6. the display: plain UVs across its extent, blank material. After the
  //    merge, because prune drops texture coordinates nothing samples yet.
  let scr = primitivesUnder(screenNode);
  let sb = new THREE.Box3();
  for (const p of scr) forEachVertex(p, (v) => sb.expandByPoint(v));
  if (cfg.screenRect) {
    // the old face becomes black glass; a new panel of the true active size
    // sits just in front
    const glass = blackGlass(doc);
    for (const p of scr) p.prim.setMaterial(glass);
    screenNode.setName('');
    screenNode.getMesh().setName('');
    // after flatten every mesh node sits at the scene root, so world space is the app's frame
    const [w, h] = cfg.screenRect.map((x) => x / 1000);
    const c = sb.getCenter(v3()), z = sb.max.z + 0.0002;
    const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].flatMap(([x, y]) => [c.x + x, c.y + y, z]);
    const buf = root.listBuffers()[0];
    const pos = doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(corners));
    const nrm = doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]));
    const idx = doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint16Array([0, 1, 2, 0, 2, 3]));
    const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nrm).setIndices(idx);
    const node = doc.createNode('screen').setMesh(doc.createMesh('screen').addPrimitive(prim));
    scene.addChild(node);
    screenNode = node;
    scr = primitivesUnder(node);
    sb = new THREE.Box3();
    for (const p of scr) forEachVertex(p, (v) => sb.expandByPoint(v));
  }
  const ss = sb.getSize(v3());
  writeScreenUVs(doc, scr, doc.createMaterial('screen').setBaseColorFactor([1, 1, 1, 1]).setExtras({ screen: true }));
  // the cover screen is on the back: its UVs run right to left as seen from the front
  if (coverNode) writeScreenUVs(doc, primitivesUnder(coverNode), doc.createMaterial('cover').setBaseColorFactor([1, 1, 1, 1]).setExtras({ screen: 'cover' }), true);

  // 6b. a foldable: split at the crease. After the screen UVs, so footage runs
  //     on unbroken across the two halves.
  if (cfg.fold) {
    splitAtFold(doc, scene, cfg.fold, screenNode);
    await doc.transform(weld());   // the cut parts are rebuilt a vertex per corner: share them again
  }

  // 7. textures to WebP, at most 1024 px — they're seen at phone-to-laptop scale
  await doc.transform(
    prune({ keepAttributes: true }),     // the old screen material and its wallpaper
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88 }),
  );
  if (cfg.simplify) {
    await MeshoptSimplifier.ready;
    await doc.transform(weld());
    const { ratio, error, materials } = cfg.simplify;
    for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
      if (materials.includes(p.getMaterial()?.getName())) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error });
    }
  }
  await MeshoptEncoder.ready;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${id}.glb`);
  await io.write(file, doc);

  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  const mm = (v) => (v * 1000).toFixed(1);
  console.log(`${id}: ${(fs.statSync(file).size / 1e6).toFixed(2)} MB, ${tris} tris, ${root.listMeshes().length} meshes, ` +
    `body ${mm(size.x)}×${mm(size.y)}×${mm(size.z)} mm, screen ${mm(ss.x)}×${mm(ss.y)} mm (aspect ${(ss.x / ss.y).toFixed(4)})` +
    (cfg.hinge ? `, hinge at y ${mm(pivot.y + off.y)} z ${mm(pivot.z + off.z)} mm, modelled at ${(cfg.hinge.kind === 'lid' ? 90 + phi * 180 / Math.PI : phi * 180 / Math.PI).toFixed(1)}°` : ''));
}

/** Plain 0–1 UVs across a display's extent, as seen from the side it faces
    (x, y in the app's frame; mirrored for one on the back), and a blank
    material the app replaces. v runs upward: the app's screen textures use
    flipY. */
function writeScreenUVs(doc, prims, material, back = false) {
  const box = new THREE.Box3();
  for (const p of prims) forEachVertex(p, (v) => box.expandByPoint(v));
  const size = box.getSize(v3());
  for (const p of prims) {
    const uv = new Float32Array(p.prim.getAttribute('POSITION').getCount() * 2);
    forEachVertex(p, (v, i) => {
      const u = (v.x - box.min.x) / size.x;
      uv[i * 2] = back ? 1 - u : u;
      uv[i * 2 + 1] = (v.y - box.min.y) / size.y;
    });
    const buf = doc.getRoot().listBuffers()[0];
    for (const sem of p.prim.listSemantics()) if (sem !== 'POSITION' && sem !== 'NORMAL') p.prim.setAttribute(sem, null);
    p.prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buf)).setMaterial(material);
  }
}

/** Split an open foldable at its crease: every part on the turning side (or
    its triangles there — those crossing the crease are cut in two, their
    attributes interpolated) moves to a node "fold" on the hinge line. */
function splitAtFold(doc, scene, kind, screenNode) {
  const buf = doc.getRoot().listBuffers()[0];
  const sb = new THREE.Box3();
  for (const p of primitivesUnder(screenNode)) forEachVertex(p, (v) => sb.expandByPoint(v));
  const c = sb.getCenter(v3());
  const book = kind === 'vertical';
  // the hinge line runs along the crease, on the inner screen's face
  const pivot = new THREE.Vector3(book ? c.x : 0, book ? 0 : c.y, sb.max.z);
  const side = (p) => (book ? p[0] - pivot.x : p[1] - pivot.y);   // > 0: the half that turns
  // closing turns the right half toward the viewer about y (negative), or the top half about x (positive)
  const fold = doc.createNode('fold').setTranslation(pivot.toArray()).setExtras({ axis: book ? 'y' : 'x', sign: book ? -1 : 1 });
  const toPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z).toArray();
  const identity = new THREE.Matrix4();

  for (const node of [...scene.listChildren()]) {
    if (!node.getMesh()) continue;
    // world space is the app's frame: bake each part's own transform first
    const w = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    if (!w.equals(identity)) {
      const own = node.getMesh().listParents().filter((x) => x.propertyType === 'Node').length > 1 ? node.getMesh().clone() : node.getMesh();
      transformMesh(own, w.toArray());
      node.setMesh(own).setMatrix(identity.toArray());
    }
    const mesh = node.getMesh(), turning = doc.createMesh(mesh.getName());
    for (const prim of mesh.listPrimitives()) {
      const { stays, turns } = splitPrimitive(doc, buf, prim, side);
      if (turns) turning.addPrimitive(transformPrimitiveOwn(turns, toPivot));
      if (stays !== prim) {
        mesh.removePrimitive(prim);
        if (stays) mesh.addPrimitive(stays);
      }
    }
    if (!turning.listPrimitives().length) { turning.dispose(); continue; }
    const name = node.getName();
    const moved = doc.createNode(mesh.listPrimitives().length ? (name ? `${name}-fold` : '') : name).setMesh(turning);
    fold.addChild(moved);
    if (!mesh.listPrimitives().length) node.dispose();
  }
  scene.addChild(fold);
}

/** A primitive's copy with its own vertex data, transformed. */
function transformPrimitiveOwn(prim, matrix) {
  for (const sem of prim.listSemantics()) prim.setAttribute(sem, prim.getAttribute(sem).clone());
  if (prim.getIndices()) prim.setIndices(prim.getIndices().clone());
  transformPrimitive(prim, matrix);
  return prim;
}

/** Split a triangle primitive by the sign of side(position). Returns
    { stays, turns }: the original primitive when it lies wholly on one
    side, new ones when it's cut, null for a side it doesn't reach. */
function splitPrimitive(doc, buf, prim, side) {
  if (prim.getMode() !== 4) return { stays: prim, turns: null };
  const sems = prim.listSemantics(), attrs = sems.map((s) => prim.getAttribute(s));
  const P = sems.indexOf('POSITION'), N = sems.indexOf('NORMAL');
  const idx = prim.getIndices(), count = idx ? idx.getCount() : attrs[P].getCount();
  const vertex = (i) => attrs.map((a) => a.getElement(i, []));
  const eps = 1e-7;
  let pos = 0, neg = 0;
  for (let i = 0; i < count; i++) {
    const d = side(attrs[P].getElement(idx ? idx.getScalar(i) : i, []));
    if (d > eps) pos++; else if (d < -eps) neg++;
  }
  if (!pos) return { stays: prim, turns: null };
  if (!neg) return { stays: null, turns: prim.clone() };

  const out = { stays: sems.map(() => []), turns: sems.map(() => []) };
  const emit = (to, v) => v.forEach((e, k) => out[to][k].push(...e));
  const lerp = (a, b, t) => a.map((ea, k) => {
    const e = ea.map((x, j) => x + (b[k][j] - x) * t);
    if (k === N) { const l = Math.hypot(...e) || 1; return e.map((x) => x / l); }
    return e;
  });
  for (let i = 0; i < count; i += 3) {
    const tri = [0, 1, 2].map((j) => vertex(idx ? idx.getScalar(i + j) : i + j));
    const d = tri.map((v) => side(v[P]));
    if (d.every((x) => x >= -eps)) { tri.forEach((v) => emit('turns', v)); continue; }
    if (d.every((x) => x <= eps)) { tri.forEach((v) => emit('stays', v)); continue; }
    // cut: clip the triangle to each side and fan the pieces back into triangles
    for (const [to, sgn] of [['turns', 1], ['stays', -1]]) {
      const poly = [];
      for (let j = 0; j < 3; j++) {
        const a = tri[j], b = tri[(j + 1) % 3], da = d[j] * sgn, db = d[(j + 1) % 3] * sgn;
        if (da >= 0) poly.push(a);
        if ((da >= 0) !== (db >= 0)) poly.push(lerp(a, b, da / (da - db)));
      }
      for (let j = 1; j + 1 < poly.length; j++) [poly[0], poly[j], poly[j + 1]].forEach((v) => emit(to, v));
    }
  }
  const make = (lists) => {
    if (!lists[P].length) return null;
    const q = doc.createPrimitive().setMaterial(prim.getMaterial());
    sems.forEach((sem, k) => q.setAttribute(sem,
      doc.createAccessor().setType(attrs[k].getType()).setBuffer(buf).setArray(new Float32Array(lists[k]))));
    const n = lists[P].length / 3;
    q.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(Uint32Array.from({ length: n }, (_, i) => i)));
    return q;
  };
  return { stays: make(out.stays), turns: make(out.turns) };
}

function listMeshes(device, size) {
  const mm = (v) => (v * 1000).toFixed(1);
  console.log(`body ${mm(size.x)}×${mm(size.y)}×${mm(size.z)} mm`);
  for (const p of primitivesUnder(device)) {
    const b = new THREE.Box3();
    forEachVertex(p, (v) => b.expandByPoint(v));
    const s = b.getSize(v3()), c = b.getCenter(v3());
    const m = p.prim.getMaterial();
    const f = m?.getBaseColorFactor().map((x) => x.toFixed(2)).join(',');
    console.log(`${p.node.getName().padEnd(16)} ${String(m?.getName()).padEnd(16)} [${f}]${m?.getBaseColorTexture() ? ' tex' : ''} ` +
      `met=${m?.getMetallicFactor().toFixed(2)} rough=${m?.getRoughnessFactor().toFixed(2)} ` +
      `size ${mm(s.x)}×${mm(s.y)}×${mm(s.z)} at ${mm(c.x)},${mm(c.y)},${mm(c.z)}`);
  }
}

const args = process.argv.slice(2);
const list = args.includes('--list');
const debug = args.includes('--debug');
const ids = args.filter((a) => !a.startsWith('--'));
for (const id of ids.length ? ids : Object.keys(CONFIG).filter((k) => !CONFIG[k].retired)) await prepare(id, { list, debug });
