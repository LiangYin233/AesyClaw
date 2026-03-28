import { computed, onBeforeUnmount, onMounted, reactive, readonly, ref, watch } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import type { AgentRole, AgentRoleConfig, AppConfig, SkillInfo, ToolInfo } from '@/lib/types';

export function useAgentsState(token: string | null) {
  const agents = ref<AgentRole[]>([]);
  const config = ref<AppConfig | null>(null);
  const skills = ref<SkillInfo[]>([]);
  const tools = ref<ToolInfo[]>([]);
  const error = ref('');
  const loading = ref(false);
  const saving = ref(false);
  const drawerMode = ref<'create' | 'edit' | null>(null);
  const selectedAgent = ref<AgentRole | null>(null);
  let stopAgentsSubscription: (() => void) | null = null;
  let stopConfigSubscription: (() => void) | null = null;
  let stopSkillsSubscription: (() => void) | null = null;
  let stopToolsSubscription: (() => void) | null = null;

  const form = reactive<AgentRoleConfig>({
    name: '',
    description: '',
    model: '',
    systemPrompt: '',
    allowedSkills: [],
    allowedTools: []
  });

  const mainAgent = computed(() => agents.value.find((agent) => agent.name === 'main') || agents.value.find((agent) => agent.builtin) || null);
  const secondaryAgents = computed(() => agents.value.filter((agent) => !mainAgent.value || agent.name !== mainAgent.value.name));
  const visionEnabled = computed(() => agents.value.filter((agent) => agent.vision).length);
  const totalLinkedTools = computed(() => agents.value.reduce((sum, agent) => sum + agent.allowedTools.length, 0));
  const missingResourcesCount = computed(() => agents.value.filter((agent) => agent.missingSkills.length > 0 || agent.missingTools.length > 0).length);
  const providerOptions = computed(() => Object.keys(config.value?.providers || {}));

  function createTemplate(): AgentRoleConfig {
    const main = config.value?.agents?.roles?.main;
    return {
      name: '',
      description: main?.description || '',
      model: main?.model || '',
      systemPrompt: main?.systemPrompt || '',
      allowedSkills: [...(main?.allowedSkills || [])],
      allowedTools: [...(main?.allowedTools || [])]
    };
  }

  function applyForm(source: AgentRoleConfig) {
    form.name = source.name;
    form.description = source.description;
    form.model = source.model;
    form.systemPrompt = source.systemPrompt;
    form.allowedSkills = [...source.allowedSkills];
    form.allowedTools = [...source.allowedTools];
  }

  async function loadAgentsPage() {
    loading.value = true;
    error.value = '';

    const [agentsResult, configResult, skillsResult, toolsResult] = await Promise.all([
      rpcCall<{ agents: AgentRole[] }>('agents.list', token),
      rpcCall<AppConfig>('config.get', token),
      rpcCall<{ skills: SkillInfo[] }>('skills.list', token),
      rpcCall<{ tools: ToolInfo[] }>('system.getTools', token)
    ]);

    if (agentsResult.error) {
      error.value = agentsResult.error;
    }

    agents.value = agentsResult.data?.agents || [];
    config.value = configResult.data;
    skills.value = skillsResult.data?.skills || [];
    tools.value = toolsResult.data?.tools || [];
    loading.value = false;

    if (!selectedAgent.value && drawerMode.value !== 'create') {
      applyForm(createTemplate());
    }
  }

  function openCreateDrawer() {
    drawerMode.value = 'create';
    selectedAgent.value = null;
    applyForm(createTemplate());
  }

  function selectAgent(agent: AgentRole) {
    drawerMode.value = 'edit';
    selectedAgent.value = agent;
    applyForm({
      name: agent.name,
      description: agent.description || '',
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      allowedSkills: [...agent.allowedSkills],
      allowedTools: [...agent.allowedTools]
    });
  }

  function resetSelection() {
    drawerMode.value = null;
    selectedAgent.value = null;
  }

  async function saveAgent() {
    saving.value = true;
    const payload: AgentRoleConfig = {
      name: form.name.trim(),
      description: form.description.trim(),
      model: form.model.trim(),
      systemPrompt: form.systemPrompt,
      allowedSkills: [...form.allowedSkills],
      allowedTools: [...form.allowedTools]
    };

    const result = drawerMode.value === 'edit' && selectedAgent.value
      ? await rpcCall<{ agent: AgentRole }>('agents.update', token, {
        ...payload,
        name: selectedAgent.value.name
      })
      : await rpcCall<{ agent: AgentRole }>('agents.create', token, payload);

    saving.value = false;

    if (result.error) {
      error.value = result.error;
      return;
    }

    if (result.data?.agent) {
      selectAgent(result.data.agent);
      return;
    }

    resetSelection();
  }

  async function deleteAgent() {
    if (!selectedAgent.value || selectedAgent.value.builtin) {
      return;
    }

    const confirmed = window.confirm(`确定删除 Agent ${selectedAgent.value.name} 吗？`);
    if (!confirmed) {
      return;
    }

    saving.value = true;
    const result = await rpcCall<{ success: boolean }>('agents.delete', token, { name: selectedAgent.value.name });
    saving.value = false;

    if (result.error) {
      error.value = result.error;
      return;
    }

    resetSelection();
  }

  function agentStatusLabel(agent: AgentRole) {
    if (agent.missingSkills.length || agent.missingTools.length) {
      return '异常';
    }
    if (agent.vision || agent.reasoning) {
      return '增强';
    }
    return '就绪';
  }

  function agentStatusDot(agent: AgentRole) {
    if (agent.missingSkills.length || agent.missingTools.length) {
      return 'bg-error';
    }
    if (agent.vision || agent.reasoning) {
      return 'bg-tertiary';
    }
    return 'bg-emerald-500';
  }

  function agentVisualTone(agent: AgentRole) {
    if (agent.missingSkills.length || agent.missingTools.length) {
      return { icon: 'warning', iconBg: 'bg-error-container/45', iconText: 'text-error' };
    }
    if (agent.vision) {
      return { icon: 'eye', iconBg: 'bg-tertiary-fixed/35', iconText: 'text-tertiary' };
    }
    return { icon: 'robot', iconBg: 'bg-surface-container-high', iconText: 'text-on-surface-variant' };
  }

  watch([agents, selectedAgent], ([nextAgents, currentSelected]) => {
    if (!currentSelected) {
      if (drawerMode.value !== 'create') {
        applyForm(createTemplate());
      }
      return;
    }

    const latest = nextAgents.find((agent) => agent.name === currentSelected.name);
    if (!latest) {
      resetSelection();
      applyForm(createTemplate());
      return;
    }

    selectedAgent.value = latest;
    if (drawerMode.value === 'edit') {
      applyForm({
        name: latest.name,
        description: latest.description || '',
        model: latest.model,
        systemPrompt: latest.systemPrompt,
        allowedSkills: [...latest.allowedSkills],
        allowedTools: [...latest.allowedTools]
      });
    }
  });

  function stopSubscriptions() {
    stopAgentsSubscription?.();
    stopAgentsSubscription = null;
    stopConfigSubscription?.();
    stopConfigSubscription = null;
    stopSkillsSubscription?.();
    stopSkillsSubscription = null;
    stopToolsSubscription?.();
    stopToolsSubscription = null;
  }

  function bindSubscriptions() {
    stopSubscriptions();

    stopAgentsSubscription = rpcSubscribe<{ agents: AgentRole[] }>(
      'agents.list',
      token,
      undefined,
      (data) => {
        agents.value = data.agents;
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

    stopConfigSubscription = rpcSubscribe<AppConfig>(
      'config.state',
      token,
      undefined,
      (data) => {
        config.value = data;
      }
    );

    stopSkillsSubscription = rpcSubscribe<{ skills: SkillInfo[] }>(
      'skills.list',
      token,
      undefined,
      (data) => {
        skills.value = data.skills;
      }
    );

    stopToolsSubscription = rpcSubscribe<{ tools: ToolInfo[] }>(
      'system.tools',
      token,
      undefined,
      (data) => {
        tools.value = data.tools;
      }
    );
  }

  onMounted(() => {
    void loadAgentsPage();
    bindSubscriptions();
  });

  onBeforeUnmount(() => {
    stopSubscriptions();
  });

  return {
    agents: readonly(agents),
    skills: readonly(skills),
    tools: readonly(tools),
    error: readonly(error),
    loading: readonly(loading),
    saving: readonly(saving),
    drawerMode: readonly(drawerMode),
    selectedAgent: readonly(selectedAgent),
    form,
    mainAgent,
    secondaryAgents,
    visionEnabled,
    totalLinkedTools,
    missingResourcesCount,
    providerOptions,
    applyForm,
    openCreateDrawer,
    selectAgent,
    resetSelection,
    saveAgent,
    deleteAgent,
    agentStatusLabel,
    agentStatusDot,
    agentVisualTone
  };
}
