import { defineConfig, UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const buildTarget = process.env.BUILD_TARGET // 'prelude' | 'content' | 'ui' | 'popup'

/**
 * Production-grade build configuration
 * - content.js: Full IIFE with inlineDynamicImports for VRM/Three.js bundle
 * - popup: Standalone settings UI page
 * - UI pages: ES modules with code splitting
 */
export default defineConfig(({ mode }): UserConfig => {
  const baseConfig: UserConfig = {
    resolve: {
      dedupe: ['react', 'react-dom', 'zustand', 'three'],
      alias: {
        react: resolve(__dirname, '../../node_modules/react'),
        'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
        'react/jsx-runtime': resolve(__dirname, '../../node_modules/react/jsx-runtime'),
        '@yumi/echo-avatar': resolve(__dirname, '../../packages/echo-avatar/src/index.ts'),
      }
    },
    optimizeDeps: {
      include: ['three', '@pixiv/three-vrm']
    },
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          { src: 'manifest.json', dest: '.' },
          { src: 'public/companions', dest: '.' },
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

  /** CONTENT SCRIPT BUILD: Self-contained IIFE with VRM/Three.js bundled */
  if (buildTarget === 'content') {
    return {
      ...baseConfig,
      plugins: [react()],
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        __DEV__: JSON.stringify(mode === 'development'),
      },
      build: {
        ...baseConfig.build,
        lib: {
          entry: resolve(__dirname, 'src/content/index.ts'),
          name: 'YumiContent',
          formats: ['iife'],
          fileName: () => 'content.js'
        },
        rollupOptions: {
          output: {
            format: 'iife',
            inlineDynamicImports: true
          }
        }
      }
    }
  }

  /** PRELUDE BUILD: Kept for backward compatibility but can be removed */
  if (buildTarget === 'prelude') {
    return {
      ...baseConfig,
      plugins: [react()],
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
