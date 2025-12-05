import { defineConfig, UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const buildTarget = process.env.BUILD_TARGET // 'prelude' | 'content' | 'ui' | 'popup'

// Production-grade: Separate build targets for prelude, content, popup, and UI
// - prelude.js: Minimal IIFE, configures Module.locateFile (no deps, no inlining needed)
// - content.js: Full IIFE with inlineDynamicImports for pixi-live2d-display
// - popup: Standalone settings UI page
// - UI pages: ES modules with code splitting
export default defineConfig(({ mode }): UserConfig => {
  const baseConfig: UserConfig = {
    resolve: {
      dedupe: ['react', 'react-dom', 'zustand'], // Prevent duplicate React/Zustand copies
      alias: {
        // Enforce absolute path resolution for React to guarantee single instance
        react: resolve(__dirname, 'node_modules/react'),
        'react-dom': resolve(__dirname, 'node_modules/react-dom'),
        'react/jsx-runtime': resolve(__dirname, 'node_modules/react/jsx-runtime'),
        // Resolve @pixi/* packages that are nested inside pixi.js/node_modules
        // (pixi-live2d-display imports these but they're not hoisted to root)
        '@pixi/display': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/display'),
        '@pixi/loaders': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/loaders'),
        '@pixi/interaction': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/interaction'),
        '@pixi/app': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/app'),
        '@pixi/graphics': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/graphics'),
        '@pixi/sprite': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/sprite'),
        '@pixi/text': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/text'),
        '@pixi/mesh': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/mesh'),
        '@pixi/accessibility': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/accessibility')
      }
    },
    optimizeDeps: {
      include: [
        'pixi.js',
        'pixi-live2d-display',
        '@pixi/unsafe-eval',
        // Include all @pixi/* packages used by pixi-live2d-display
        '@pixi/display',
        '@pixi/core',
        '@pixi/math',
        '@pixi/utils',
        '@pixi/ticker',
        '@pixi/loaders',
        '@pixi/constants'
      ]
    },
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          { src: 'manifest.json', dest: '.' },
          // Copy public folder contents explicitly to avoid duplicates
          { src: 'public/companions', dest: '.' },
          { src: 'public/cubism-sdk', dest: '.' },
          { src: 'public/icons', dest: '.' },
          { src: 'public/avatar-yumi.png', dest: '.' }
        ],
        hook: 'writeBundle'
      })
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: buildTarget === 'ui' || !buildTarget, // Only clear on first build
      chunkSizeWarningLimit: 1000,
      sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false, // Inline sourcemaps for dev
      minify: process.env.NODE_ENV === 'development' ? false : 'esbuild' // No minify in dev
    }
  }

  // PRELUDE BUILD: Minimal IIFE to configure Module.locateFile
  if (buildTarget === 'prelude') {
    return {
      ...baseConfig,
      plugins: [react()], // No static copy needed for prelude-only build
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        __DEV__: JSON.stringify(mode === 'development'),
      },
      build: {
        ...baseConfig.build,
        lib: {
          entry: resolve(__dirname, 'src/content/prelude.ts'),
          name: 'YumiPrelude',
          formats: ['iife'],
          fileName: () => 'prelude.js'
        },
        rollupOptions: {
          output: {
            format: 'iife'
            // No inlineDynamicImports - prelude has zero dependencies
          }
        }
      }
    }
  }

  // CONTENT SCRIPT BUILD: Self-contained IIFE with all dependencies inlined
  if (buildTarget === 'content') {
    return {
      ...baseConfig,
      plugins: [react()], // No static copy needed for content-only build
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        __DEV__: JSON.stringify(mode === 'development'),
      },
      resolve: {
        ...baseConfig.resolve,
        // Force all @pixi/* imports to resolve to ESM versions from pixi.js
        alias: {
          ...baseConfig.resolve?.alias,
          // Packages inside pixi.js/node_modules (not at top level)
          '@pixi/display': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/display/dist/esm/display.mjs'),
          '@pixi/app': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/app/dist/esm/app.mjs'),
          '@pixi/graphics': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/graphics/dist/esm/graphics.mjs'),
          '@pixi/sprite': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/sprite/dist/esm/sprite.mjs'),
          '@pixi/text': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/text/dist/esm/text.mjs'),
          '@pixi/interaction': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/interaction/dist/esm/interaction.mjs'),
          '@pixi/loaders': resolve(__dirname, 'node_modules/pixi.js/node_modules/@pixi/loaders/dist/esm/loaders.mjs'),
          // Packages at top level node_modules/@pixi
          '@pixi/core': resolve(__dirname, 'node_modules/@pixi/core/dist/esm/core.mjs'),
          '@pixi/math': resolve(__dirname, 'node_modules/@pixi/math/dist/esm/math.mjs'),
          '@pixi/utils': resolve(__dirname, 'node_modules/@pixi/utils/dist/esm/utils.mjs'),
          '@pixi/settings': resolve(__dirname, 'node_modules/@pixi/settings/dist/esm/settings.mjs'),
          '@pixi/constants': resolve(__dirname, 'node_modules/@pixi/constants/dist/esm/constants.mjs'),
          '@pixi/ticker': resolve(__dirname, 'node_modules/@pixi/ticker/dist/esm/ticker.mjs'),
          '@pixi/runner': resolve(__dirname, 'node_modules/@pixi/runner/dist/esm/runner.mjs')
        }
      },
      build: {
        ...baseConfig.build,
        commonjsOptions: {
          include: /node_modules/,
          transformMixedEsModules: true, // Handle modules that mix ESM and CJS
          requireReturnsDefault: 'auto' // Better handling of default exports
        },
        lib: {
          entry: resolve(__dirname, 'src/content/index.ts'),
          name: 'YumiContent',
          formats: ['iife'],
          fileName: () => 'content.js'
        },
        rollupOptions: {
          output: {
            format: 'iife',
            inlineDynamicImports: true // Bundle dynamic import('pixi-live2d-display/lib/cubism4')
          }
        }
      }
    }
  }

  // POPUP BUILD: Standalone settings UI
  if (buildTarget === 'popup') {
    return {
      ...baseConfig,
      plugins: [react()], // No static copy needed for popup-only build
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        __DEV__: JSON.stringify(mode === 'development'),
      },
      build: {
        ...baseConfig.build,
        rollupOptions: {
          input: {
            popup: resolve(__dirname, 'src/popup/index.html')
          },
          output: {
            entryFileNames: 'popup/assets/[name]-[hash].js',
            chunkFileNames: 'popup/assets/[name]-[hash].js',
            assetFileNames: (asset) => {
              if (asset.name && asset.name.endsWith('.css')) return 'popup/assets/[name]-[hash][extname]'
              return 'popup/assets/[name]-[hash][extname]'
            }
          }
        }
      }
    }
  }

  // DEFAULT BUILD: Background service worker only (can use ES modules & code splitting)
  return {
    ...baseConfig,
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      __DEV__: JSON.stringify(mode === 'development'),
    },
    build: {
      ...baseConfig.build,
      rollupOptions: {
        input: {
          background: resolve(__dirname, 'src/background/index.ts')
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: (asset) => {
            if (asset.name && asset.name.endsWith('.css')) return 'assets/[name]-[hash][extname]'
            return 'assets/[name]-[hash][extname]'
          }
        }
      }
    }
  }
})
