import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiPost } from '../utils/apiClient'
import type { SkillInfo, SkillReloadSummary } from '../types/api'
import { withRequestState } from '../utils/requestState'

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<SkillInfo[]>([])
  const selectedSkill = ref<SkillInfo | null>(null)
  const loading = ref(false)
  const reloading = ref(false)
  const error = ref<string | null>(null)

  async function fetchSkills() {
    return withRequestState(loading, error, async () => {
      const { data, error: err } = await apiGet<{ skills: SkillInfo[] }>('/skills')
      if (err) {
        error.value = err
        skills.value = []
        return []
      }
      skills.value = data?.skills || []
      if (selectedSkill.value && !skills.value.some((item) => item.name === selectedSkill.value?.name)) {
        selectedSkill.value = null
      }
      return skills.value
    })
  }

  async function fetchSkill(name: string) {
    const { data, error: err } = await apiGet<{ skill: SkillInfo }>(`/skills/${name}`)
    if (err) {
      error.value = err
      return null
    }
    selectedSkill.value = data?.skill || null
    return selectedSkill.value
  }

  async function toggleSkill(name: string, enabled: boolean) {
    const { error: err } = await apiPost(`/skills/${name}/toggle`, { enabled })
    if (err) {
      error.value = err
      return false
    }
    const skill = skills.value.find((item) => item.name === name)
    if (skill) {
      skill.enabled = enabled
    }
    return true
  }

  async function reloadSkills() {
    return withRequestState(reloading, error, async () => {
      const { data, error: err } = await apiPost<{ success: boolean; summary: SkillReloadSummary }>('/skills/reload')
      if (err) {
        error.value = err
        return null
      }

      await fetchSkills()
      return data?.summary || null
    })
  }

  return { skills, selectedSkill, loading, reloading, error, fetchSkills, fetchSkill, toggleSkill, reloadSkills }
})
