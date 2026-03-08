<template>
    <div class="cron-page">
        <div class="page-header">
            <h1>定时任务</h1>
            <div class="header-actions">
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadJobs" :loading="loading" />
                <Button label="新建任务" icon="pi pi-plus" @click="openCreateDialog" />
            </div>
        </div>
        
        <div v-if="jobs.length > 0" class="jobs-list">
            <Card v-for="job in jobs" :key="job.id" class="job-card">
                <template #title>
                    <div class="job-header">
                        <span class="job-name">{{ job.name }}</span>
                        <Tag :value="getScheduleLabel(job.schedule)" :severity="getScheduleSeverity(job.schedule)" />
                    </div>
                </template>
                <template #content>
                    <div class="job-details">
                        <div class="detail-row">
                            <span class="detail-label">任务ID:</span>
                            <span class="detail-value">{{ job.id }}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">状态:</span>
                            <Tag :value="job.enabled ? '已启用' : '已禁用'" :severity="job.enabled ? 'success' : 'danger'" />
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">下次执行:</span>
                            <span class="detail-value">{{ formatTime(job.nextRunAtMs) }}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">上次执行:</span>
                            <span class="detail-value">{{ formatTime(job.lastRunAtMs) }}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">目标:</span>
                            <span class="detail-value">{{ job.payload?.target || '-' }}</span>
                        </div>
                    </div>
                </template>
                <template #footer>
                    <div class="job-actions">
                        <Button 
                            :icon="job.enabled ? 'pi pi-pause' : 'pi pi-play'" 
                            :label="job.enabled ? '禁用' : '启用'"
                            :severity="job.enabled ? 'warning' : 'success'"
                            size="small" 
                            @click="toggleJob(job)" 
                        />
                        <Button icon="pi pi-pencil" label="编辑" severity="info" size="small" outlined @click="openEditDialog(job)" />
                        <Button icon="pi pi-trash" label="删除" severity="danger" size="small" outlined @click="confirmDelete(job)" />
                    </div>
                </template>
            </Card>
        </div>
        
        <Message v-else-if="!loading" severity="info" :closable="false">
            暂无定时任务，点击上方创建
        </Message>
        
        <div v-else class="loading-container">
            <ProgressSpinner />
        </div>
        
        <Dialog v-model:visible="dialogVisible" :header="isEditing ? '编辑任务' : '新建任务'" :modal="true" :style="{ width: '500px' }">
            <div class="form-fields">
                <div class="form-field">
                    <label>任务名称</label>
                    <InputText v-model="form.name" placeholder="任务名称" fluid />
                </div>
                <div class="form-field">
                    <label>执行类型</label>
                    <Select v-model="form.scheduleKind" :options="scheduleTypes" optionLabel="label" optionValue="value" placeholder="选择执行类型" @change="onScheduleTypeChange" />
                </div>
                <div class="form-field" v-if="form.scheduleKind === 'once'">
                    <label>执行时间</label>
                    <DatePicker v-model="form.onceAt" showTime hourFormat="24" placeholder="选择时间" fluid />
                </div>
                <div class="form-field" v-if="form.scheduleKind === 'interval'">
                    <label>间隔时间</label>
                    <InputText v-model="form.intervalStr" placeholder="如: 10m, 1h, 30s" fluid />
                </div>
                <div class="form-field" v-if="form.scheduleKind === 'daily'">
                    <label>每日时间</label>
                    <InputText v-model="form.dailyAt" placeholder="如: 09:00" fluid />
                </div>
                <div class="form-field" v-if="form.scheduleKind === 'cron'">
                    <label>Cron 表达式</label>
                    <InputText v-model="form.cronExpr" placeholder="分 时 日 月 周 (如: 0 9 * * *)" fluid />
                </div>
                <div class="form-field">
                    <label>任务描述</label>
                    <InputText v-model="form.description" placeholder="任务简介" fluid />
                </div>
                <div class="form-field">
                    <label>详细指令</label>
                    <Textarea v-model="form.detail" placeholder="触发时将发送给LLM处理的指令" rows="3" fluid />
                </div>
                <div class="form-field">
                    <label>发送目标</label>
                    <InputText v-model="form.target" placeholder="onebot:private:QQ号 或 onebot:group:群号" fluid />
                </div>
                <div class="form-field">
                    <label>启用状态</label>
                    <ToggleButton v-model="form.enabled" onLabel="已启用" offLabel="已禁用" />
                </div>
            </div>
            <template #footer>
                <Button label="取消" severity="secondary" @click="dialogVisible = false" />
                <Button label="保存" @click="saveJob" :loading="saving" />
            </template>
        </Dialog>
        
        <Dialog v-model:visible="deleteDialogVisible" header="确认删除" :modal="true" :style="{ width: '400px' }">
            <p>确定要删除任务 "{{ jobToDelete?.name }}" 吗？</p>
            <template #footer>
                <Button label="取消" severity="secondary" @click="deleteDialogVisible = false" />
                <Button label="删除" severity="danger" @click="deleteJob" :loading="deleting" />
            </template>
        </Dialog>
        
        <Toast />
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useApi, type CronJob } from '../composables/useApi'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import ToggleButton from 'primevue/togglebutton'
import Dialog from 'primevue/dialog'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import Toast from 'primevue/toast'
import ProgressSpinner from 'primevue/progressspinner'
import DatePicker from 'primevue/datepicker'

const { getCronJobs, getCronJob, createCronJob, updateCronJob, deleteCronJob, toggleCronJob } = useApi()
const toast = useToast()

const jobs = ref<CronJob[]>([])
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)

const dialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const isEditing = ref(false)
const jobToDelete = ref<CronJob | null>(null)
const editingJobId = ref('')

const scheduleTypes = [
    { label: '执行一次', value: 'once' },
    { label: '间隔执行', value: 'interval' },
    { label: '每日执行', value: 'daily' },
    { label: 'Cron 表达式', value: 'cron' }
]

const form = reactive({
    name: '',
    scheduleKind: 'once' as 'once' | 'interval' | 'daily' | 'cron',
    onceAt: null as Date | null,
    intervalStr: '',
    dailyAt: '',
    cronExpr: '',
    description: '',
    detail: '',
    target: '',
    enabled: true
})

async function loadJobs() {
    loading.value = true
    jobs.value = await getCronJobs()
    loading.value = false
}

function openCreateDialog() {
    isEditing.value = false
    editingJobId.value = ''
    form.name = ''
    form.scheduleKind = 'once'
    form.onceAt = null
    form.intervalStr = ''
    form.dailyAt = ''
    form.cronExpr = ''
    form.description = ''
    form.detail = ''
    form.target = ''
    form.enabled = true
    dialogVisible.value = true
}

async function openEditDialog(job: CronJob) {
    isEditing.value = true
    editingJobId.value = job.id

    // Fetch full job details if detail is masked
    let fullJob = job
    if (job.payload?.detail === '[隐藏]') {
        try {
            const fetched = await getCronJob(job.id)
            if (fetched) {
                fullJob = fetched
            }
        } catch (error) {
            console.error('Failed to fetch full job details:', error)
            // Continue with masked data if fetch fails
        }
    }

    // Populate form with full job data
    form.name = fullJob.name
    form.scheduleKind = fullJob.schedule.kind
    form.onceAt = fullJob.schedule.onceAt ? new Date(fullJob.schedule.onceAt) : null
    form.intervalStr = fullJob.schedule.intervalMs ? formatIntervalMs(fullJob.schedule.intervalMs) : ''
    form.dailyAt = fullJob.schedule.dailyAt || ''
    form.cronExpr = fullJob.schedule.cronExpr || ''
    form.description = fullJob.payload?.description || ''
    form.detail = fullJob.payload?.detail || ''
    form.target = fullJob.payload?.target || ''
    form.enabled = fullJob.enabled
    dialogVisible.value = true
}

function onScheduleTypeChange() {
    form.onceAt = null
    form.intervalStr = ''
    form.dailyAt = ''
    form.cronExpr = ''
}

async function saveJob() {
    if (!form.name || !form.detail) {
        toast.add({ severity: 'warn', summary: '警告', detail: '请填写任务名称和详细指令', life: 3000 })
        return
    }

    const schedule: any = { kind: form.scheduleKind }
    
    switch (form.scheduleKind) {
        case 'once':
            if (form.onceAt) {
                schedule.onceAt = form.onceAt.toISOString()
            }
            break
        case 'interval':
            if (form.intervalStr) {
                const ms = parseIntervalStr(form.intervalStr)
                if (!ms) {
                    toast.add({ severity: 'warn', summary: '警告', detail: '无效的间隔格式', life: 3000 })
                    return
                }
                schedule.intervalMs = ms
            }
            break
        case 'daily':
            schedule.dailyAt = form.dailyAt
            break
        case 'cron':
            schedule.cronExpr = form.cronExpr
            break
    }

    const jobData = {
        name: form.name,
        schedule,
        payload: {
            description: form.description,
            detail: form.detail,
            target: form.target
        },
        enabled: form.enabled
    }

    saving.value = true
    let success = false
    
    if (isEditing.value) {
        success = await updateCronJob(editingJobId.value, jobData)
    } else {
        const result = await createCronJob(jobData)
        success = result !== null
    }
    
    saving.value = false
    
    if (success) {
        dialogVisible.value = false
        toast.add({ severity: 'success', summary: '成功', detail: isEditing.value ? '任务已更新' : '任务已创建', life: 3000 })
        loadJobs()
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: '操作失败', life: 3000 })
    }
}

function confirmDelete(job: CronJob) {
    jobToDelete.value = job
    deleteDialogVisible.value = true
}

async function deleteJob() {
    if (!jobToDelete.value) return
    
    deleting.value = true
    const success = await deleteCronJob(jobToDelete.value.id)
    deleting.value = false
    
    if (success) {
        deleteDialogVisible.value = false
        toast.add({ severity: 'success', summary: '成功', detail: '任务已删除', life: 3000 })
        loadJobs()
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: '删除失败', life: 3000 })
    }
}

async function toggleJob(job: CronJob) {
    const success = await toggleCronJob(job.id, !job.enabled)
    if (success) {
        toast.add({ severity: 'success', summary: '成功', detail: job.enabled ? '任务已禁用' : '任务已启用', life: 3000 })
        loadJobs()
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: '操作失败', life: 3000 })
    }
}

function getScheduleLabel(schedule: CronJob['schedule']): string {
    switch (schedule.kind) {
        case 'once': return '执行一次'
        case 'interval': return '间隔执行'
        case 'daily': return '每日执行'
        case 'cron': return 'Cron'
        default: return schedule.kind
    }
}

function getScheduleSeverity(schedule: CronJob['schedule']): string {
    switch (schedule.kind) {
        case 'once': return 'info'
        case 'interval': return 'warning'
        case 'daily': return 'success'
        case 'cron': return 'help'
        default: return 'info'
    }
}

function formatTime(ms?: number): string {
    if (!ms) return '-'
    return new Date(ms).toLocaleString('zh-CN')
}

function formatIntervalMs(ms: number): string {
    if (ms >= 86400000) return `${ms / 86400000}d`
    if (ms >= 3600000) return `${ms / 3600000}h`
    if (ms >= 60000) return `${ms / 60000}m`
    return `${ms / 1000}s`
}

function parseIntervalStr(str: string): number | null {
    const match = str.match(/^(\d+)(s|m|h|d)$/)
    if (!match) return null
    
    const value = parseInt(match[1])
    const unit = match[2]
    
    switch (unit) {
        case 's': return value * 1000
        case 'm': return value * 60 * 1000
        case 'h': return value * 60 * 60 * 1000
        case 'd': return value * 24 * 60 * 60 * 1000
        default: return null
    }
}

onMounted(() => {
    loadJobs()
})
</script>

<style scoped>
.cron-page {
    padding: 0;
}

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
}

.page-header h1 {
    margin: 0;
    font-size: 24px;
    font-weight: bold;
}

.header-actions {
    display: flex;
    gap: 8px;
}

.jobs-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.job-card {
    margin-bottom: 0;
}

.job-header {
    display: flex;
    align-items: center;
    gap: 12px;
}

.job-name {
    font-weight: 500;
}

.job-details {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.detail-row {
    display: flex;
    gap: 8px;
    align-items: center;
}

.detail-label {
    font-weight: 500;
    color: #64748b;
    min-width: 80px;
}

.detail-value {
    color: #334155;
}

.job-actions {
    display: flex;
    gap: 8px;
}

.form-fields {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.form-field label {
    font-size: 14px;
    font-weight: 500;
    color: #475569;
}

.loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px;
}

@media (prefers-color-scheme: dark) {
    .form-field label {
        color: #94a3b8;
    }
    .detail-label {
        color: #94a3b8;
    }
    .detail-value {
        color: #e2e8f0;
    }
}
</style>
