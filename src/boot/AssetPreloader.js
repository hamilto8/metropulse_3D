function preloadImage(source, ImageConstructor = globalThis.Image) {
  if (!source || typeof ImageConstructor !== 'function') {
    return Promise.reject(new Error('Image preparation is unavailable.'));
  }
  return new Promise((resolve, reject) => {
    const image = new ImageConstructor();
    image.decoding = 'async';
    image.onload = () => resolve(source);
    image.onerror = () => reject(new Error(`Required startup asset could not be loaded: ${source}`));
    image.src = source;
  });
}

export class AssetPreloader {
  constructor({ ImageConstructor = globalThis.Image, fonts = globalThis.document?.fonts } = {}) {
    this.ImageConstructor = ImageConstructor;
    this.fonts = fonts;
  }

  async prepare({ images = [] } = {}) {
    const prepared = await Promise.all(
      images.map(source => preloadImage(source, this.ImageConstructor))
    );
    // Font loading is presentation enhancement, not a reason to strand a
    // playable local session when an external font host is unavailable.
    try {
      await this.fonts?.ready;
    } catch {
      // The CSS system-font fallback remains usable.
    }
    return Object.freeze({ images: Object.freeze(prepared) });
  }
}

export { preloadImage };

export default AssetPreloader;
