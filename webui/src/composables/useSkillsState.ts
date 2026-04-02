import { computed, onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import type { SkillInfo } from '@/lib/types';

export function useSkillsState(token: string | null) {
  const skills = ref<SkillInfo[]>([]);
  const selectedName = ref('');
  const selectedSkill = ref<SkillInfo | null>(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const reloading = ref(false);
  const error = ref('');
  let stopSkillsSubscription: (() => void) | null = null;
  let stopSkillDetailSubscription: (() => void) | null = null;

  const builtinCount = computed(() => skills.value.filter((skill) => skill.builtin).length);
  const externalCount = computed(() => skills.value.filter((skill) => !skill.builtin).length);
  const enabledCount = computed(() => skills.value.filter((skill) => skill.enabled).length);

  function selectSkill(name: string) {
    selectedName.value = name;
  }

  function syncSkills(nextSkills: SkillInfo[]) {
    skills.value = nextSkills;

    if (selectedName.value && nextSkills.some((skill) => skill.name === selectedName.value)) {
      return;
    }

    selectedName.value = nextSkills[0]?.name || '';
  }

  async function reloadSkills() {
    reloading.value = true;
    const result = await rpcCall<{ success: true }>('skills.reload', token);
    reloading.value = false;

    if (result.error) {
      error.value = result.error;
    }
  }

  async function toggleSkill(skill: SkillInfo) {
    if (!skill.configurable) {
      return;
    }

    const result = await rpcCall<{ success: true }>('skills.toggle', token, {
      name: skill.name,
      enabled: !skill.enabled
    });

    if (result.error) {
      error.value = result.error;
    }
  }

  function bindSkillsSubscription() {
    stopSkillsSubscription?.();
    loading.value = true;
    stopSkillsSubscription = rpcSubscribe<{ skills: SkillInfo[] }>(
      'skills.list',
      token,
      undefined,
      (data) => {
        syncSkills(data.skills);
        loading.value = false;
        error.value = '';
      },
      {
        onError: (message) => {
          error.value = message;
          loading.value = false;
        }
      }
    );
  }

  function bindSkillDetailSubscription(name: string) {
    stopSkillDetailSubscription?.();
    stopSkillDetailSubscription = null;

    if (!name) {
      selectedSkill.value = null;
      detailLoading.value = false;
      return;
    }

    detailLoading.value = true;
    stopSkillDetailSubscription = rpcSubscribe<{ skill: SkillInfo } | null>(
      'skills.detail',
      token,
      { name },
      (data) => {
        if (!data?.skill) {
          if (selectedName.value === name) {
            selectedName.value = skills.value[0]?.name || '';
          }
          return;
        }

        selectedSkill.value = data.skill;
        detailLoading.value = false;
        error.value = '';
      },
      {
        onError: (message) => {
          error.value = message;
          detailLoading.value = false;
        }
      }
    );
  }

  function stopSubscriptions() {
    stopSkillsSubscription?.();
    stopSkillsSubscription = null;
    stopSkillDetailSubscription?.();
    stopSkillDetailSubscription = null;
  }

  watch(selectedName, (name) => {
    if (!name) {
      selectedSkill.value = null;
      detailLoading.value = false;
      return;
    }

    bindSkillDetailSubscription(name);
  }, { immediate: true });

  onMounted(() => {
    bindSkillsSubscription();
  });

  onBeforeUnmount(() => {
    stopSubscriptions();
  });

  return {
    skills: readonly(skills),
    selectedName,
    selectedSkill: readonly(selectedSkill),
    loading: readonly(loading),
    detailLoading: readonly(detailLoading),
    reloading: readonly(reloading),
    error: readonly(error),
    builtinCount,
    externalCount,
    enabledCount,
    selectSkill,
    reloadSkills,
    toggleSkill
  };
}
