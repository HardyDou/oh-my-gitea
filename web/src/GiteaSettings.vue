<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const emit = defineEmits<{ saved: [] }>()
type Settings = { baseUrl: string; clientId: string; hasClientSecret: boolean; hasWebhookSecret: boolean; redirectUri: string }
const initialized = ref(false)
const ready = ref(false)
const statusError = ref('')
const password = ref('')
const confirmation = ref('')
const unlocked = ref(false)
const busy = ref(false)
const settings = ref<Settings>({ baseUrl: '', clientId: '', hasClientSecret: false, hasWebhookSecret: false, redirectUri: '' })
const clientSecret = ref('')
const webhookSecret = ref('')
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'include', cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) {
    if (response.status === 401) unlocked.value = false
    throw new Error(data.message || '配置请求失败')
  }
  return data as T
}
async function loadStatus() {
  statusError.value = ''; ready.value = false
  try {
    const status = await request<{ initialized: boolean; authenticated: boolean }>('/api/v1/admin/status')
    initialized.value = status.initialized
    unlocked.value = status.authenticated
    if (status.authenticated) settings.value = await request<Settings>('/api/v1/config/gitea')
    ready.value = true
  } catch (error) { statusError.value = (error as Error).message }
}
async function unlock() {
  if (!initialized.value && password.value !== confirmation.value) { ElMessage.error('两次输入的密码不一致'); return }
  busy.value = true
  try {
    await request(`/api/v1/admin/${initialized.value ? 'login' : 'setup'}`, 'POST', { password: password.value })
    password.value = ''; confirmation.value = ''
    initialized.value = true
    settings.value = await request<Settings>('/api/v1/config/gitea')
    unlocked.value = true
  } catch (error) {
    ElMessage.error((error as Error).message)
    // 另一位管理员可能已完成初始化，重新读取实际状态。
    await loadStatus()
  } finally { busy.value = false }
}
async function lock() {
  busy.value = true
  try {
    await request('/api/v1/admin/logout', 'POST')
    password.value = ''; confirmation.value = ''; clientSecret.value = ''; webhookSecret.value = ''; unlocked.value = false
  } catch (error) { ElMessage.error((error as Error).message) }
  finally { busy.value = false }
}
async function save() {
  try {
    await ElMessageBox.confirm('保存后 Gitea 用户需要重新登录。密钥留空表示保留原值，是否继续？', '保存 Gitea 配置', { type: 'warning', confirmButtonText: '保存', cancelButtonText: '取消' })
  } catch { return }
  busy.value = true
  try {
    settings.value = await request<Settings>('/api/v1/config/gitea', 'PUT', { baseUrl: settings.value.baseUrl, clientId: settings.value.clientId, clientSecret: clientSecret.value, webhookSecret: webhookSecret.value })
    clientSecret.value = ''; webhookSecret.value = ''
    ElMessage.success('Gitea 配置已保存，请重新登录 Gitea')
    emit('saved')
  } catch (error) { ElMessage.error((error as Error).message) }
  finally { busy.value = false }
}
onMounted(loadStatus)
</script>

<template>
  <section class="gitea-settings">
    <h1>Gitea 集成</h1>
    <p>设置 Gitea 服务器和账号登录方式。首次使用先设置管理员密码，以后用此密码修改配置。</p>
    <div v-if="statusError"><el-alert :title="statusError" type="error" :closable="false" /><el-button @click="loadStatus">重试</el-button></div>
    <p v-else-if="!ready">正在读取配置状态…</p>
    <template v-else>
      <el-alert v-if="!initialized" title="首次设置：请自行设置管理员密码，没有公共默认密码。请在本机或可信网络完成设置，再开放公网访问。" type="info" :closable="false" />
      <el-form v-if="!unlocked" label-position="top" @submit.prevent="unlock">
        <h2>{{ initialized ? '管理员登录' : '设置管理员密码' }}</h2>
        <el-form-item :label="initialized ? '管理员密码' : '新密码'">
          <el-input v-model="password" type="password" show-password :autocomplete="initialized ? 'current-password' : 'new-password'" :maxlength="128" :placeholder="initialized ? '请输入管理员密码（不是 Gitea 密码）' : '至少 8 位，建议混合字母、数字和符号'" />
        </el-form-item>
        <el-form-item v-if="!initialized" label="确认密码">
          <el-input v-model="confirmation" type="password" show-password autocomplete="new-password" :maxlength="128" placeholder="请再次输入密码" />
        </el-form-item>
        <el-button native-type="submit" type="primary" :loading="busy" :disabled="!password || (!initialized && (!confirmation || password.length < 8))">{{ initialized ? '解锁配置' : '设置密码并继续' }}</el-button>
        <p>此密码只管理本系统配置，与 Gitea 账号独立。请妥善保管，并通过 HTTPS 或本机访问。</p>
      </el-form>
      <el-form v-else label-position="top" @submit.prevent="save">
        <el-form-item label="Gitea 地址">
          <el-input v-model="settings.baseUrl" placeholder="https://gitea.example.com" />
          <small>已有用户或仓库数据后，不能直接更换实例地址，以免不同实例的数据混用。</small>
        </el-form-item>
        <el-form-item label="OAuth Client ID"><el-input v-model="settings.clientId" autocomplete="off" /></el-form-item>
        <el-form-item label="OAuth Client Secret">
          <el-input v-model="clientSecret" type="password" show-password autocomplete="new-password" :placeholder="settings.hasClientSecret ? '已配置，留空保留原值' : '请输入 Client Secret；公共 OAuth 客户端可留空'" />
        </el-form-item>
        <el-form-item label="OAuth 回调地址">
          <el-input :model-value="settings.redirectUri" readonly />
          <small>请将此地址原样填入 Gitea OAuth 应用。该地址由部署环境决定，不随 Gitea 地址变化。</small>
        </el-form-item>
        <el-form-item label="Webhook 密钥（可选）">
          <el-input v-model="webhookSecret" type="password" show-password autocomplete="new-password" :placeholder="settings.hasWebhookSecret ? '已配置，留空保留原值' : '不使用 Webhook 时无需填写'" />
          <small>未配置时禁用 Webhook 接收，不影响 OAuth 登录。此处不会自动注册 Gitea Webhook。</small>
        </el-form-item>
        <p>敏感字段加密保存，不回显。保存后请测试 Gitea 登录。管理员会话有效期为 30 分钟。</p>
        <el-button :disabled="busy" @click="lock">退出管理</el-button>
        <el-button native-type="submit" type="primary" :loading="busy" :disabled="!settings.baseUrl || !settings.clientId">保存 Gitea 配置</el-button>
      </el-form>
    </template>
  </section>
</template>

<style scoped>
.gitea-settings { max-width: 760px; padding: 24px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; }
.gitea-settings h1 { margin: 0 0 12px; font-size: 22px; }
.gitea-settings h2 { font-size: 18px; }
.gitea-settings p, .gitea-settings small { color: #6b7280; line-height: 1.7; }
.gitea-settings form { margin-top: 24px; }
.gitea-settings small { display: block; margin-top: 6px; }
</style>
