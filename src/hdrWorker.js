/* Decodes a lighting panorama (.hdr) off the main thread: a 2K one is
   ~6 MB of RGBE to unpack into half floats, which froze the page for a
   moment on the main thread. Its pixels go back as a transferable buffer
   (lighting.js). */

import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const loader = new HDRLoader();   // half floats, as the main-thread loader made

self.onmessage = async ({ data: { id, url } }) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const { width, height, data, type } = loader.parse(await res.arrayBuffer());
    self.postMessage({ id, width, height, data, type }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
