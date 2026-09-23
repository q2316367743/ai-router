<template>
  <div class="balancer">
    <div class="row">
      <div class="row-main">
        <div class="row-title">启用负载均衡</div>
        <div class="row-hint">
          关闭后按单渠道直连：不按可用度分流、不拦额度、失败不改道（下面三项一并失效）
        </div>
      </div>
      <t-switch :value="config.enabled" @change="(v: unknown) => save({ enabled: v === true })" />
    </div>

    <div class="row">
      <div class="row-main">
        <div class="row-title">会话亲和</div>
        <div class="row-hint">
          同一会话固定同一渠道，保住上游 prompt cache 命中率；渠道被阻断或失败改道后自动改绑。
          会话标识取请求头（x-session-id 等）→ 协议元数据 → 首条消息指纹
        </div>
      </div>
      <t-switch
        :value="config.sessionAffinity"
        :disabled="!config.enabled"
        @change="(v: unknown) => save({ sessionAffinity: v === true })"
      />
    </div>

    <div class="row">
      <div class="row-main">
        <div class="row-title">额度前置拦截</div>
        <div class="row-hint">
          余量快照显示额度已用尽（窗口用完 / 余额为 0）时直接把该渠道可用度归零，请求不再发给它；
          余额或窗口恢复时直接拉满，不逐点回涨
        </div>
      </div>
      <t-switch
        :value="config.quotaGuard"
        :disabled="!config.enabled"
        @change="(v: unknown) => save({ quotaGuard: v === true })"
      />
    </div>

    <div class="row">
      <div class="row-main">
        <div class="row-title">最大尝试渠道数</div>
        <div class="row-hint">
          单次请求最多尝试几个渠道（含首个）：改道只在尚未向客户端写出任何字节时发生
        </div>
      </div>
      <t-input-number
        :value="config.maxAttempts"
        :min="1"
        :max="MAX_ATTEMPTS_LIMIT"
        :step="1"
        size="small"
        theme="normal"
        style="width: 120px"
        :disabled="!config.enabled"
        @change="onAttemptsChange"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 负载均衡配置（设置页「负载均衡」卡内容）：**即改即存**（落库并广播），故无保存按钮。
 *
 * 配置读取与主进程共用 `parseBalancerConfig`，界面显示的口径就是引擎跑的口径。
 */
import type { BalancerConfig } from '@common/types'
import { BALANCER_SETTING_KEY, MAX_ATTEMPTS_LIMIT } from '@common/types'
import { parseBalancerConfig } from '@common/utils/balancerConfig'
import { MessageUtil } from '@/utils/modal'

const config = ref<BalancerConfig>(parseBalancerConfig(null))

async function save(patch: Partial<BalancerConfig>): Promise<void> {
  const next = { ...config.value, ...patch }
  config.value = next
  try {
    await window.preload.setting.set(BALANCER_SETTING_KEY, next)
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '保存负载均衡配置失败')
  }
}

/** 输入过程中不落库（每次按键都写库会触发全窗口广播），失焦 / 回车 / 步进才保存 */
function onAttemptsChange(value: unknown, context: { type: string }): void {
  if (context.type === 'input') return
  const next = Number(value)
  if (!Number.isFinite(next)) return
  void save({ maxAttempts: next })
}

onMounted(async () => {
  try {
    config.value = parseBalancerConfig(await window.preload.setting.get(BALANCER_SETTING_KEY))
  } catch {
    // 读不到就用默认值展示，保存时会写入完整配置
  }
})
</script>

<style scoped lang="less">
.balancer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 12px;
  border-radius: var(--fluent-radius-card);
  /* 设置卡底已是 secondarycontainer，行用更亮的 container 才有「浮起」层级（同托盘额度行） */
  background-color: var(--td-bg-color-container);
  border: 1px solid var(--fluent-border-subtle);
}

.row-main {
  flex: 1;
  min-width: 0;
}

.row-title {
  font-size: 13px;
  color: var(--td-text-color-primary);
}

.row-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--td-text-color-secondary);
}
</style>
