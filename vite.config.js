import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  return {
    base: command === 'build' ? '/metropulse_3D/' : '/',
    build: {
      rolldownOptions: {
        output: {
          // Keep stable framework/physics code cacheable independently from
          // frequently changing gameplay code.
          codeSplitting: {
            groups: [
              { name: 'three-addons', test: /node_modules\/three\/examples\/jsm\//, includeDependenciesRecursively: false },
              { name: 'three-vendor', test: /node_modules\/three\//, includeDependenciesRecursively: false },
              { name: 'physics-vendor', test: /node_modules\/cannon-es\//, includeDependenciesRecursively: false }
            ]
          }
        }
      }
    }
  };
});
