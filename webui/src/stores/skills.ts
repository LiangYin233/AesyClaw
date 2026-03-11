import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet, apiPost } from '../utils/apiClient'
import type { SkillInfo } from '../types/api'

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<SkillInfo[]>([])
  const selectedSkill = ref<SkillInfo | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchSkills() {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await apiGet<{ skills: SkillInfo[] }>('/skills')
      if (err) {
        error.value = err
        skills.value = []
        return []
      }
      skills.value = data?.skills || []
      return skills.value
    } finally {
      loading.value = false
    }
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

  return { skills, selectedSkill, loading, error, fetchSkills, fetchSkill, toggleSkill }
})
