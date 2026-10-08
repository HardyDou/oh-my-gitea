<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const emit = defineEmits<{ saved: [] }>()
type Settings = { baseUrl: string; clientId: string; hasClientSecret: boolean; hasWebhookSecret: boolean; redirectUri: string }
const adminToken = ref('')
const unlocked = ref(false)
const busy = ref(false)
const settings = ref<Settings>({ baseUrl: '', clientId: '', hasClientSecret: false, hasWebhookSecret: false, redirectUri: '' })
const clientSecret = ref('')
const webhookSecret = ref('')
async function request(method: 'GET' | 'PUT') {
  const response = await fetch('/api/v1/config/gitea', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-System-Config-Token': adminToken.value },
    body: method === 'PUT' ? JSON.stringify({ baseUrl: settings.value.baseUrl, clientId: settings.value.clientId, clientSecret: clientSecret.value, webhookSecret: webhookSecret.value }) : undefined,
    cache: 'no-store',
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || '配置请求失败')
  return data as Settings
}
async function unlock() {
  busy.value = true
  try { settings.value = await request('GET'); unlocked.value = true }
  catch (error) { ElMessage.error((error as Error).message) }
  finally { busy.value = false }
}
function lock() {
  adminToken.value = ''; clientSecret.value = ''; webhookSecret.value = ''; unlocked.value = false
}
async function save() {
  try {
    await ElMessageBox.confirm('保存后所有用户需要重新登录。密钥留空表示保留原值，是否继续？', '保存 Gitea 配置', { type: 'warning', confirmButtonText: '保存', cancelButtonText: '取消' })
  } catch { return }
  busy.value = true
  try {
    settings.value = await request('PUT')
    lock()
    ElMessage.success('Gitea 配置已保存，请重新登录')
    emit('saved')
  } catch (error) { ElMessage.error((error as Error).message) }
  finally { busy.value = false }
}
</script>

<template>
  <section class="gitea-settings">
    <h1>Gitea 集成</h1>
    <p>配置 Gitea 数据源及 OAuth 登录。首次部署无需登录即可配置，但必须持有部署管理密钥。</p>
    <el-alert title="仅部署管理员可操作。管理密钥来自环境变量 SYSTEM_CONFIG_TOKEN，不是 Gitea 访问令牌。请通过 HTTPS 或本机访问此页面。" type="info" :closable="false" />
    <el-form v-if="!unlocked" label-position="top" @submit.prevent="unlock">
      <el-form-item label="管理密钥">
        <el-input v-model="adminToken" type="password" show-password autocomplete="off" placeholder="请输入 SYSTEM_CONFIG_TOKEN" />
      </el-form-item>
      <el-button native-type="submit" type="primary" :loading="busy" :disabled="!adminToken">解锁配置</el-button>
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
      <el-form-item label="Webhook 密钥">
        <el-input v-model="webhookSecret" type="password" show-password autocomplete="new-password" :placeholder="settings.hasWebhookSecret ? '已配置，留空保留原值' : '请输入随机密钥（必填）'" />
        <small>此项仅保存现有 Webhook 接收接口凭据，不会自动创建或注册 Gitea Webhook。</small>
      </el-form-item>
      <p>敏感字段加密保存在数据库中，不回显。保存不会验证 Gitea 连通性，请保存后测试登录。</p>
      <el-button :disabled="busy" @click="lock">锁定配置</el-button>
      <el-button native-type="submit" type="primary" :loading="busy" :disabled="!settings.baseUrl || !settings.clientId">保存 Gitea 配置</el-button>
    </el-form>
  </section>
</template>

<style scoped>
.gitea-settings { max-width: 760px; padding: 24px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; }
.gitea-settings h1 { margin: 0 0 12px; font-size: 22px; }
.gitea-settings p, .gitea-settings small { color: #6b7280; line-height: 1.7; }
.gitea-settings form { margin-top: 24px; }
.gitea-settings small { display: block; margin-top: 6px; }
</style>
