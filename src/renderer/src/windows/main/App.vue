<template>
  <div class="app-shell">
    <!-- 无边框窗口（hiddenInset / titleBarOverlay）顶部拖拽区，业务页面注意避开顶部 38px -->
    <div class="window-drag-region"></div>
    <router-view />
  </div>
</template>

<script lang="ts" setup></script>

<style lang="less" scoped>
.app-shell {
  height: 100%;
}
</style>
