/* =====================================================================
   Contact shadows

   The devices are rendered from below the floor, looking up, into a
   texture: each pixel's darkness falls off with height, so objects closer
   to the floor cast darker shadows. That texture is blurred and laid on
   the floor as a transparent plane.

   Why not the key light's shadow map? Shadow maps compare depths, and
   softening them is where every variant falls down — PCF turns grainy at
   large radii, and VSM either shows acne (floor in its own map) or erases
   shadows when blurred (floor excluded). Blurring an *image* can't do
   either, so softness is unconditional and artifact-free. This is the same
   technique three.js uses in its product-viewer examples.

   The projection is sheared along the key light's direction, so shadows
   still fall away from the light instead of pooling straight down.
   ===================================================================== */

import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

export const SHADOW_LAYER = 1;     // devices opt in; the floor, gizmos and the shadow plane don't
const RES = 1024;

function blurMaterial(shader) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(shader.uniforms),
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
}

export class ContactShadow {
  constructor(renderer) {
    this.renderer = renderer;
    // half-float so a long, soft falloff doesn't band
    const opts = { type: THREE.HalfFloatType };
    this.rt = new THREE.WebGLRenderTarget(RES, RES, opts);
    this.rtTmp = new THREE.WebGLRenderTarget(RES, RES, { ...opts, depthBuffer: false });
    this.rt.texture.generateMipmaps = this.rtTmp.texture.generateMipmaps = false;

    // what the viewer sees: a floor-level plane showing the blurred silhouette
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));   // match the up-looking camera
    this.plane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.rt.texture, transparent: true, depthWrite: false, toneMapped: false,
    }));
    this.plane.renderOrder = -1;           // under everything else that's transparent

    // the camera sits at floor level and looks straight up
    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
    this.camera.rotation.x = Math.PI / 2;
    this.camera.layers.set(SHADOW_LAYER);

    // each fragment writes black with alpha = darkness, fading with height
    this.depthMaterial = new THREE.MeshDepthMaterial();
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), 1.0 - fragCoordZ );',
      );
    };

    // full-screen quad for the separable blur passes
    this.hBlur = blurMaterial(HorizontalBlurShader);
    this.vBlur = blurMaterial(VerticalBlurShader);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.hBlur);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadCam.position.z = 0.5;

    this.shear = new THREE.Matrix4();
  }

  /**
   * center: Vector3 (x/z used) · half: half-width of the covered square (m)
   * height: tallest point that still casts (m) · shear: [kx, kz] offset per metre of height
   * blur: blur radius (m) · opacity: 0–1
   */
  update(scene, { center, half, height, shear, blur, opacity }) {
    const r = this.renderer;
    const cam = this.camera;

    this.plane.position.set(center.x, 0.0004, center.z);
    this.plane.scale.set(half * 2, 1, half * 2);
    this.plane.material.opacity = opacity;

    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = 0; cam.far = Math.max(0.02, height);
    cam.position.set(center.x, 0, center.z);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    /* Shear world space along the light before projecting: a point at height y
       lands at (x − kx·y, z − kz·y). The renderer multiplies the projection by
       the view matrix V, so P·V·S·V⁻¹ here becomes P·V·S in effect. */
    const [kx, kz] = shear;
    this.shear.set(
      1, -kx, 0, 0,
      0, 1, 0, 0,
      0, -kz, 1, 0,
      0, 0, 0, 1,
    );
    cam.projectionMatrix
      .multiply(cam.matrixWorldInverse)
      .multiply(this.shear)
      .multiply(cam.matrixWorld);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

    // render the silhouettes, leaving everything about the renderer as we found it
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevBg = scene.background;
    const prevOverride = scene.overrideMaterial;
    const prevShadowAuto = r.shadowMap.autoUpdate;

    scene.background = null;
    scene.overrideMaterial = this.depthMaterial;
    r.shadowMap.autoUpdate = false;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, cam);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;

    /* A wide, smooth blur from a 9-tap kernel: three passes at halving step
       sizes approximate one large Gaussian without visible banding. */
    const radiusUv = blur / (2 * half);
    const minStep = 0.5 / RES;
    for (const k of [0.25, 0.125, 0.0625]) {
      const step = Math.max(minStep, radiusUv * k);
      this.pass(this.hBlur, 'h', this.rt, this.rtTmp, step);
      this.pass(this.vBlur, 'v', this.rtTmp, this.rt, step);
    }

    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    r.shadowMap.autoUpdate = prevShadowAuto;
  }

  pass(material, key, from, to, step) {
    material.uniforms.tDiffuse.value = from.texture;
    material.uniforms[key].value = step;
    this.quad.material = material;
    this.renderer.setRenderTarget(to);
    this.renderer.render(this.quad, this.quadCam);
  }

  dispose() {
    this.rt.dispose(); this.rtTmp.dispose();
    this.plane.geometry.dispose(); this.plane.material.dispose();
    this.depthMaterial.dispose(); this.hBlur.dispose(); this.vBlur.dispose();
    this.quad.geometry.dispose();
  }
}
