import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { TDesignResolver } from 'unplugin-vue-components/resolvers'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        $: resolve('src/main/src'),
        '~': resolve('src/preload/src'),
        '@resources': resolve('resources'),
        '@common': resolve('src/common')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '~': resolve('src/preload/src'),
        $: resolve('src/main/src'),
        '@common': resolve('src/common')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@common': resolve('src/common')
      }
    },
    plugins: [
      vue(),
      vueJsx(),
      UnoCSS(),
      AutoImport({
        resolvers: [
          TDesignResolver({
            library: 'vue-next'
          })
        ],
        imports: ['vue', '@vueuse/core', 'vue-router'],
        eslintrc: {
          enabled: true
        }
      }),
      Components({
        resolvers: [
          TDesignResolver({
            library: 'vue-next'
          })
        ]
      }),
      visualizer({
        open: false,
        filename: 'stats.html',
        gzipSize: true,
        brotliSize: true,
        emitFile: false
      })
    ],
    base: './',
    server: {
      port: 7744
    }
  }
})
