(function () {
  const state = {
    script: null,
    storyboard: [],
    competitors: [],
    analysis: null,
    topics: [],
    selectedTopic: null,
    creativePack: null,
    calendar: [],
    history: [],
    currentHistoryId: null,
    projects: [],
    currentProjectId: null,
    currentEpisodeId: null,
    reviewEpisodeId: null,
    topicBatch: 0,
    planOptions: [],
    selectedPlanOptionId: null,
    activeAiOperation: null,
  };

  const draftKey = "roco-shortdrama-studio-draft";
  const historyKey = "roco-shortdrama-studio-history";
  const projectsKey = "roco-shortdrama-studio-projects";
  const accessCodeKey = "roco-shortdrama-access-code";
  const maxHistoryItems = 60;
  const apiTimeoutMs = 90_000;
  const apiClient = window.RocoApiClient.create({ accessCodeKey, timeoutMs: apiTimeoutMs });
  const archiveStore = window.RocoDataStore.create();

  const defaultBible = {
    characters: "主角：有明确欲望、弱点与不可突破的底线。\n搭档精灵：有独立意志，不是随时替主角解决问题的工具。",
    abilities: "精灵能力必须有代价、冷却或场景限制；危机不能靠突然升级无代价解决。",
    relations: "角色关系要在每集发生可见变化：信任、误会、亏欠或共同秘密至少推进一项。",
    antagonist: "反派目标清晰，手段与主线矛盾相关；反派每次出手都要留下可追踪的代价或线索。",
    worldRules: "以《洛克王国：世界》手游开放世界为语境：探索、传送、精灵互动、收集、区域任务与首领挑战。",
    mainConflict: "主角必须在个人愿望与守护精灵/世界秩序之间做选择，主线问题不能被单集轻易解决。",
    hookRules: "前 3 秒抛出可见危机或异常信息；结尾只揭开一个新信息，并留下下一集必须行动的问题。",
  };
  const projectDomain = window.RocoProjectDomain;
  const newId = projectDomain.newId;
  const activeEpisodeVersion = projectDomain.activeEpisodeVersion;
  const applyEpisodeVersion = projectDomain.applyEpisodeVersion;
  const normalizeProjectEpisodes = projectDomain.normalizeProjectEpisodes;
  const validateEpisodePlan = projectDomain.validateEpisodePlan;
  const deriveReviewInsights = projectDomain.deriveReviewInsights;
  const episodePlanner = window.RocoEpisodePlanner;
  const uiTemplates = window.RocoUiTemplates;
  const escapeHtml = uiTemplates.escapeHtml;
  const formatItem = uiTemplates.formatItem;
  const renderList = uiTemplates.renderList;

  function createProjectRecord(name = "未命名短剧项目") {
    return projectDomain.createProjectRecord(name, defaultBible);
  }

  function nowTime() {
    return new Date().toLocaleTimeString("zh-CN", { hour12: false });
  }

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  function setStatus(message, isError = false) {
    const pill = $("#statusPill");
    if (!pill) return;
    pill.textContent = message;
    pill.classList.toggle("error", isError);
  }

  function reportError(context, error) {
    const message = error && error.message ? error.message : String(error);
    console.error(context, error);
    setStatus(`${context}失败：${message}`, true);
  }

  function usageSuffix(response) {
    const remaining = Number(response?.usage?.remaining);
    return Number.isFinite(remaining) ? ` · 今日剩余 ${remaining} 单位` : "";
  }

  function pulseResult() {
    const stage = $(".stage");
    if (!stage) return;
    stage.classList.remove("pulse");
    void stage.offsetWidth;
    stage.classList.add("pulse");
  }

  function refreshCreationActions() {
    const hasScript = Boolean(state.script);
    const hasStoryboard = Boolean(state.storyboard.length);
    const isBusy = Boolean(state.activeAiOperation);
    const hasCompletePlan = episodePlanner.planIsComplete(getInput().episodePlan);
    const generateButton = $("#generateBtn");
    const storyboardButton = $("#storyboardBtn");
    const continueButton = $("#continueBtn");
    const planReadyState = $("#planReadyState");
    const stage = $(".stage");

    if (generateButton) {
      generateButton.disabled = isBusy || !hasCompletePlan;
      generateButton.textContent = hasCompletePlan ? "生成本集剧本" : "先完成本集策划";
      generateButton.title = hasCompletePlan ? "根据已确认的本集策划生成剧本" : "请先快速填充、采用一套方案或完整填写五项策划";
    }
    if (planReadyState) {
      planReadyState.textContent = hasCompletePlan ? "本集策划已就绪，可以生成剧本" : "请先完整填写或采用一套本集策划";
      planReadyState.classList.toggle("is-ready", hasCompletePlan);
    }
    if (storyboardButton) {
      storyboardButton.disabled = isBusy || !hasScript;
      storyboardButton.title = hasScript ? "根据当前剧本生成对应分镜" : "请先生成并确认一版剧本";
    }
    if (continueButton) {
      continueButton.disabled = isBusy || !hasScript;
      continueButton.title = hasScript ? "承接当前剧本的结尾钩子续写下一集" : "请先生成一版剧本";
    }
    ["checkContinuityBtn", "regenerateTopicsBtn", "suggestPlansBtn", "autoPlanBtn", "projectSelect", "newProjectBtn", "importProjectBtn"].forEach((id) => {
      const control = document.getElementById(id);
      if (control) control.disabled = isBusy;
    });
    $$('[data-topic-generate], [data-topic-continue], [data-topic-replace], [data-plan-option]').forEach((button) => {
      button.disabled = isBusy;
    });
    document.body?.setAttribute("aria-busy", String(isBusy));
    if (stage) {
      stage.classList.toggle("has-script", hasScript);
      stage.classList.toggle("has-storyboard", hasStoryboard);
    }
    refreshToolbarState();
  }

  function beginAiOperation(label) {
    if (state.activeAiOperation) {
      const error = new Error(`${state.activeAiOperation.label}仍在处理中，请等待完成后再操作。`);
      error.code = "AI_OPERATION_BUSY";
      throw error;
    }
    const operation = {
      id: newId("ai"),
      label,
      projectId: state.currentProjectId,
      startedAt: Date.now(),
    };
    state.activeAiOperation = operation;
    refreshCreationActions();
    return operation;
  }

  function assertActiveAiOperation(operation) {
    if (state.activeAiOperation?.id !== operation.id || state.currentProjectId !== operation.projectId) {
      const error = new Error("生成期间项目状态已变化，本次返回结果已丢弃。请在当前项目重新生成。");
      error.code = "STALE_AI_RESULT";
      throw error;
    }
  }

  function endAiOperation(operation) {
    if (state.activeAiOperation?.id === operation.id) state.activeAiOperation = null;
    refreshCreationActions();
  }

  function resetCurrentCreation() {
    state.currentEpisodeId = null;
    state.reviewEpisodeId = null;
    state.currentHistoryId = null;
    state.script = null;
    state.storyboard = [];
    state.creativePack = null;
    state.selectedTopic = null;
    state.planOptions = [];
    state.selectedPlanOptionId = null;
    setInputValue("episodeNumber", nextEpisodeNumber());
    renderPlanSuggestions();
    renderScript();
    renderStoryboard();
    renderCreativePack();
    renderConsistency();
    renderExample();
  }

  function refreshToolbarState(activeTab) {
    const tabLabels = {
      project: "项目",
      bible: "短剧圣经",
      consistency: "一致性检查",
      assets: "资产库",
      script: "剧本",
      storyboard: "分镜",
      creative: "标题与封面",
      topics: "选题库",
      history: "作品库",
      calendar: "排期复盘",
      optimize: "优化方法",
      example: "示例",
    };
    const active = activeTab || $(".tab.active")?.dataset.tab || "script";
    const label = $("#toolbarActiveLabel");
    const stateLabel = $("#toolbarStateText");
    if (label) label.textContent = tabLabels[active] || "剧本";
    if (!stateLabel) return;
    stateLabel.textContent = state.storyboard.length
      ? "分镜已就绪"
      : state.script
        ? "剧本已生成，可拆分镜"
        : "等待生成剧本";
  }

  function getInput() {
    const customDuration = Number($("#customDuration")?.value || 0);
    return {
      theme: $("#theme").value.trim(),
      roles: $("#roles").value.trim(),
      scene: $("#customScene")?.value.trim() || $("#scene")?.value || "",
      direction: $("#customDirection")?.value.trim() || $("#direction").value,
      audience: $("#customAudience")?.value.trim() || $("#audience").value,
      duration: customDuration || Number($("#duration").value),
      episodeCount: Number($("#episodeCount").value),
      episodeNumber: Number($("#episodeNumber")?.value || 1),
      style: $("#customStyle")?.value.trim() || $("#style").value,
      memeSeed: $("#memeSeed") ? $("#memeSeed").value.trim() : "",
      aiModel: $("#aiModel") ? $("#aiModel").value : "",
      continueInstruction: $("#continueInstruction") ? $("#continueInstruction").value.trim() : "",
      episodePlan: {
        openingHook: $("#planOpeningHook")?.value.trim() || "",
        conflict: $("#planConflict")?.value.trim() || "",
        reversal: $("#planReversal")?.value.trim() || "",
        endingSuspense: $("#planEndingSuspense")?.value.trim() || "",
        targetEmotion: $("#planTargetEmotion")?.value.trim() || "",
      },
    };
  }

  function applyEpisodePlan(plan = {}) {
    setInputValue("planOpeningHook", plan.openingHook || "");
    setInputValue("planConflict", plan.conflict || "");
    setInputValue("planReversal", plan.reversal || "");
    setInputValue("planEndingSuspense", plan.endingSuspense || "");
    setInputValue("planTargetEmotion", plan.targetEmotion || "");
    refreshCreationActions();
  }

  function plannerContext(topic = state.selectedTopic) {
    const previousHook = state.script?.hooks?.at(-1);
    return {
      topic,
      previousHook: previousHook ? formatItem(previousHook) : "",
    };
  }

  function renderPlanSuggestions() {
    const target = $("#planSuggestions");
    if (!target) return;
    target.hidden = !state.planOptions.length;
    if (!state.planOptions.length) {
      target.innerHTML = "";
      return;
    }
    const labels = {
      openingHook: "开头",
      conflict: "冲突",
      reversal: "反转",
      endingSuspense: "悬念",
      targetEmotion: "情绪",
    };
    target.innerHTML = state.planOptions.map((option, index) => `
      <article class="plan-option ${option.id === state.selectedPlanOptionId ? "is-selected" : ""}">
        <div class="plan-option-head">
          <div>
            <span class="plan-option-kicker">${escapeHtml(option.angle)}</span>
            <h3>${escapeHtml(option.title)}</h3>
          </div>
          <button class="small-action" type="button" data-plan-option="${index}">${option.id === state.selectedPlanOptionId ? "已采用" : "采用"}</button>
        </div>
        <p>${escapeHtml(option.why)}</p>
        <ul class="plan-option-preview">
          ${Object.entries(labels).map(([key, label]) => `<li><strong>${label}：</strong>${escapeHtml(option.plan[key])}</li>`).join("")}
        </ul>
      </article>
    `).join("");
  }

  async function suggestEpisodePlans() {
    const operation = beginAiOperation("本集策划生成");
    try {
      setStatus("DeepSeek 正在生成 3 套本集策划...");
      const input = {
        ...getInput(),
        episodePlan: {},
        previousScript: state.script || null,
      };
      const response = await apiRequest("/api/plans", { input: generationContext(input) });
      assertActiveAiOperation(operation);
      const options = episodePlanner.normalizePlanOptions(response.result, { prefix: "ai-plan" });
      if (options.length !== 3) throw new Error("DeepSeek 没有返回 3 套完整策划，请重新生成。");
      state.planOptions = options;
      state.selectedPlanOptionId = null;
      renderPlanSuggestions();
      saveDraft(false);
      setStatus(`DeepSeek 已生成 3 套本集策划 ${nowTime()} · ${response.model || "model"}${usageSuffix(response)}`);
    } finally {
      endAiOperation(operation);
    }
  }

  function autoFillEpisodePlan(options = {}) {
    const input = getInput();
    if (options.fresh) input.episodePlan = {};
    const plan = episodePlanner.completePlan(input, {
      ...plannerContext(options.topic),
      seed: options.seed || Date.now(),
    });
    applyEpisodePlan(plan);
    state.selectedPlanOptionId = null;
    saveDraft(false);
    setStatus("本集策划已自动填好，可以直接修改或生成剧本");
    return plan;
  }

  function adoptPlanOption(index) {
    const option = state.planOptions[index];
    if (!option) throw new Error("没有找到这套策划，请重新生成灵感。");
    applyEpisodePlan(option.plan);
    state.selectedPlanOptionId = option.id;
    renderPlanSuggestions();
    saveDraft(false);
    setStatus(`已采用“${option.angle}”方案，可以继续微调`);
  }

  function currentProject() {
    return state.projects.find((project) => project.id === state.currentProjectId) || state.projects[0] || null;
  }

  async function persistProjects() {
    try {
      await archiveStore.set(projectsKey, state.projects);
      return true;
    } catch (error) {
      setStatus("项目档案保存失败：浏览器本地存储空间可能已满", true);
      return false;
    }
  }

  async function loadProjects() {
    try {
      const stored = await archiveStore.get(projectsKey);
      state.projects = Array.isArray(stored) ? stored : [];
    } catch (_) {
      state.projects = [];
    }
    if (!state.projects.length) state.projects = [createProjectRecord("洛克王国短剧项目")];
    state.projects = state.projects.map((project) => ({
      ...project,
      bible: { ...defaultBible, ...(project.bible || {}) },
      episodes: Array.isArray(project.episodes) ? project.episodes : [],
      assets: Array.isArray(project.assets) ? project.assets : [],
    })).map(normalizeProjectEpisodes);
    state.currentProjectId = state.projects.some((project) => project.id === state.currentProjectId)
      ? state.currentProjectId
      : state.projects[0].id;
    await persistProjects();
  }

  function nextEpisodeNumber(project = currentProject()) {
    return projectDomain.nextEpisodeNumber(project);
  }

  function currentProjectEpisode() {
    const project = currentProject();
    return project?.episodes?.find((episode) => episode.id === state.currentEpisodeId) || null;
  }

  function projectContinuity(project = currentProject(), targetEpisodeNumber = nextEpisodeNumber(project)) {
    return window.RocoWorkflowCore.continuityForTarget(project?.episodes || [], targetEpisodeNumber, 3);
  }

  function generationContext(input) {
    const project = currentProject();
    const latestReview = (project?.episodes || [])
      .filter((episode) => episode.review?.status === "reviewed" || episode.review?.status === "published")
      .sort((a, b) => String(b.review?.updatedAt || "").localeCompare(String(a.review?.updatedAt || "")))[0]?.review || null;
    return {
      ...input,
      projectName: project?.name || "未命名短剧项目",
      projectLogline: project?.logline || "",
      projectBible: project?.bible || defaultBible,
      projectContinuity: projectContinuity(project, input.episodeNumber),
      projectAssets: (project?.assets || []).slice(-24),
      latestReview,
    };
  }

  function renderBible() {
    const bible = currentProject()?.bible || defaultBible;
    const fields = {
      bibleCharacters: bible.characters,
      bibleAbilities: bible.abilities,
      bibleRelations: bible.relations,
      bibleAntagonist: bible.antagonist,
      bibleWorldRules: bible.worldRules,
      bibleMainConflict: bible.mainConflict,
      bibleHookRules: bible.hookRules,
    };
    Object.entries(fields).forEach(([id, value]) => setInputValue(id, value || ""));
  }

  function renderReviewForm() {
    const project = currentProject();
    const select = $("#reviewEpisodeSelect");
    if (!select) return;
    const episodes = project?.episodes || [];
    if (!episodes.length) {
      select.innerHTML = `<option value="">生成剧本后可复盘</option>`;
      select.disabled = true;
      return;
    }
    select.disabled = false;
    if (!episodes.some((episode) => episode.id === state.reviewEpisodeId)) {
      state.reviewEpisodeId = state.currentEpisodeId || episodes[episodes.length - 1].id;
    }
    select.innerHTML = episodes
      .slice()
      .sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber))
      .map((episode) => `<option value="${escapeHtml(episode.id)}">第 ${escapeHtml(episode.episodeNumber)} 集 · ${escapeHtml(episode.script?.title || "待生成")}</option>`)
      .join("");
    select.value = state.reviewEpisodeId;
    const review = episodes.find((episode) => episode.id === state.reviewEpisodeId)?.review || {};
    setInputValue("reviewStatus", review.status || "draft");
    setInputValue("reviewPublishDate", review.publishDate || "");
    setInputValue("reviewPublishTime", review.publishTime || "");
    setInputValue("reviewViews", review.views ?? "");
    setInputValue("reviewLikes", review.likes ?? "");
    setInputValue("reviewComments", review.comments ?? "");
    setInputValue("reviewShares", review.shares ?? "");
    setInputValue("reviewFollows", review.follows ?? "");
    setInputValue("reviewCompletionRate", review.completionRate ?? "");
    setInputValue("reviewCommentThemes", review.commentThemes || "");
    setInputValue("reviewNotes", review.notes || "");
    renderReviewInsights(review);
  }

  function renderProject() {
    const project = currentProject();
    const select = $("#projectSelect");
    if (!project || !select) return;
    select.innerHTML = state.projects.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
    select.value = project.id;
    setInputValue("projectName", project.name);
    setInputValue("projectLogline", project.logline || "");
    const episodes = project.episodes || [];
    const reviewed = episodes.filter((episode) => episode.review?.status === "reviewed").length;
    $("#projectOverview").innerHTML = [
      ["系列主线", project.logline || "尚未填写主线"],
      ["已归档集数", `${episodes.length} 集`],
      ["已完成复盘", `${reviewed} 集`],
      ["可复用资产", `${(project.assets || []).length} 条`],
    ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    const target = $("#projectEpisodeList");
    target.innerHTML = episodes.length
      ? episodes.slice().sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber)).map((episode) => `
        <article class="episode-card">
          <div class="episode-number">EP ${escapeHtml(episode.episodeNumber)}</div>
          <div>
            <div class="history-meta"><span>${escapeHtml(episode.review?.status || "draft")}</span><span>${episode.storyboard?.length || 0} 镜</span><span>${(episode.versions || []).length} 个版本</span></div>
            <h4>${escapeHtml(episode.script?.title || "待生成剧本")}</h4>
            <p>${escapeHtml(episode.script?.synopsis || "本集还没有完成剧本。")}</p>
            <div class="episode-versions">${(episode.versions || []).map((version, versionIndex) => `<button class="small-action ${version.id === episode.activeVersionId ? "is-active-version" : ""}" data-project-episode-version="${escapeHtml(episode.id)}" data-project-version-id="${escapeHtml(version.id)}">v${versionIndex + 1}</button>`).join("")}</div>
          </div>
          <div class="episode-actions">
            <button class="small-action" data-project-episode-restore="${escapeHtml(episode.id)}">打开本集</button>
            <button class="small-action" data-project-episode-review="${escapeHtml(episode.id)}">录入复盘</button>
          </div>
        </article>`).join("")
      : `<p class="helper">当前项目还没有集数。填写圣经后，回到剧本页生成第一集。</p>`;
    renderReviewForm();
  }

  function saveProjectMeta() {
    const project = currentProject();
    if (!project) return;
    project.name = $("#projectName").value.trim() || "未命名短剧项目";
    project.logline = $("#projectLogline").value.trim();
    project.updatedAt = new Date().toISOString();
    persistProjects();
    renderProject();
    setStatus("项目信息已保存");
  }

  function saveBible() {
    const project = currentProject();
    if (!project) return;
    project.bible = {
      characters: $("#bibleCharacters").value.trim(),
      abilities: $("#bibleAbilities").value.trim(),
      relations: $("#bibleRelations").value.trim(),
      antagonist: $("#bibleAntagonist").value.trim(),
      worldRules: $("#bibleWorldRules").value.trim(),
      mainConflict: $("#bibleMainConflict").value.trim(),
      hookRules: $("#bibleHookRules").value.trim(),
    };
    project.updatedAt = new Date().toISOString();
    persistProjects();
    renderProject();
    setStatus("短剧圣经已保存，后续剧本和分镜将引用它");
  }

  function createProject() {
    const project = createProjectRecord(`短剧项目 ${state.projects.length + 1}`);
    state.projects.unshift(project);
    state.currentProjectId = project.id;
    resetCurrentCreation();
    persistProjects();
    renderProject();
    renderBible();
    saveDraft(false);
    switchTab("project");
    $("#projectName")?.focus();
    $("#projectName")?.select();
    setStatus(`已新建项目：${project.name}，可直接修改名称和主线`);
  }

  function exportCurrentProject() {
    const project = currentProject();
    if (!project) return;
    const payload = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      project,
    };
    const safeName = project.name.replace(/[\\/:*?"<>|]/g, "-").slice(0, 48) || "roco-project";
    download(`${safeName}-project.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    setStatus("项目已导出，可用于备份或迁移设备");
  }

  function importProjectFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        const imported = parsed.project || parsed;
        if (!imported || typeof imported !== "object" || !String(imported.name || "").trim()) {
          throw new Error("不是有效的项目备份文件。");
        }
        const project = {
          ...createProjectRecord(`${String(imported.name).trim()}（导入）`),
          ...imported,
          id: newId("project"),
          name: `${String(imported.name).trim()}（导入）`,
          bible: { ...defaultBible, ...(imported.bible || {}) },
          assets: Array.isArray(imported.assets) ? imported.assets.map((asset) => ({ ...asset, id: newId("asset") })) : [],
          episodes: Array.isArray(imported.episodes) ? imported.episodes : [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        normalizeProjectEpisodes(project);
        project.episodes.forEach((episode) => {
          episode.id = newId("episode");
          (episode.versions || []).forEach((version) => { version.id = newId("version"); });
          episode.activeVersionId = episode.versions?.at(-1)?.id || null;
          applyEpisodeVersion(episode, episode.activeVersionId);
        });
        state.projects.unshift(project);
        state.currentProjectId = project.id;
        resetCurrentCreation();
        persistProjects();
        renderProject(); renderBible(); renderAssets(); renderConsistency(); saveDraft(false);
        setStatus(`项目已导入：${project.name}`);
      } catch (error) {
        reportError("项目导入", error);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function upsertProjectEpisode({ mode, input, response, generated, historyId }) {
    const project = currentProject();
    if (!project) return null;
    const { episode } = projectDomain.upsertEpisodeVersion(project, {
      currentEpisodeId: state.currentEpisodeId,
      mode,
      input,
      versionSnapshot: {
        input,
        script: generated.script,
        storyboard: generated.storyboard || [],
        creativePack: generated.creativePack || null,
        historyId,
        source: response.source || "",
        model: response.model || "",
        consistency: null,
      },
    });
    state.currentEpisodeId = episode.id;
    state.reviewEpisodeId = episode.id;
    persistProjects();
    renderProject();
    return episode;
  }

  function updateCurrentProjectEpisodeStoryboard(response) {
    const episode = currentProjectEpisode();
    const project = currentProject();
    if (!episode || !project) return;
    projectDomain.updateActiveStoryboard(episode, state.storyboard, response);
    project.updatedAt = episode.updatedAt;
    persistProjects();
    renderProject();
  }

  function restoreProjectEpisode(id, versionId) {
    const project = currentProject();
    const episode = project?.episodes?.find((item) => item.id === id);
    if (!episode) throw new Error("没有找到该项目集数。");
    applyEpisodeVersion(episode, versionId || episode.activeVersionId);
    Object.entries(episode.input || {}).forEach(([key, value]) => setInputValue(key, value));
    applyEpisodePlan(episode.input?.episodePlan);
    setInputValue("episodeNumber", episode.episodeNumber);
    state.currentEpisodeId = episode.id;
    state.reviewEpisodeId = episode.id;
    state.script = episode.script || null;
    state.storyboard = episode.storyboard || [];
    state.creativePack = episode.creativePack || null;
    state.currentHistoryId = episode.historyId || null;
    renderScript(); renderStoryboard(); renderCreativePack(); renderProject(); renderAssets(); renderConsistency(); renderExample(); saveDraft(false);
    switchTab("script");
    const versionIndex = (episode.versions || []).findIndex((version) => version.id === episode.activeVersionId) + 1;
    setStatus(`已打开第 ${episode.episodeNumber} 集 v${versionIndex}：${episode.script?.title || "待生成"}`);
  }

  function saveReview() {
    const episode = currentProject()?.episodes?.find((item) => item.id === state.reviewEpisodeId);
    if (!episode) throw new Error("请先选择需要复盘的集数。");
    episode.review = {
      status: $("#reviewStatus").value,
      publishDate: $("#reviewPublishDate").value,
      publishTime: $("#reviewPublishTime").value,
      views: Number($("#reviewViews").value || 0),
      likes: Number($("#reviewLikes").value || 0),
      comments: Number($("#reviewComments").value || 0),
      shares: Number($("#reviewShares").value || 0),
      follows: Number($("#reviewFollows").value || 0),
      completionRate: Number($("#reviewCompletionRate").value || 0),
      commentThemes: $("#reviewCommentThemes").value.trim(),
      notes: $("#reviewNotes").value.trim(),
      updatedAt: new Date().toISOString(),
    };
    persistProjects();
    renderProject();
    setStatus(`第 ${episode.episodeNumber} 集复盘已保存`);
  }

  function renderReviewInsights(review = {}) {
    const target = $("#reviewInsights");
    if (!target) return;
    const hasData = Object.values(review).some((value) => value !== "" && value !== 0 && value !== "draft" && value !== undefined);
    if (!hasData) {
      target.innerHTML = `<p class="helper">录入发布数据后，这里会给出下一集的钩子、标题和封面方向。</p>`;
      return;
    }
    const insights = deriveReviewInsights(review);
    target.innerHTML = [
      ["下一集钩子", insights.hook],
      ["标题方向", insights.title],
      ["封面方向", insights.cover],
    ].map(([title, body]) => `<article><h4>${escapeHtml(title)}</h4><p>${escapeHtml(body)}</p></article>`).join("");
  }

  function renderAssets() {
    const target = $("#assetLibrary");
    if (!target) return;
    const assets = currentProject()?.assets || [];
    target.innerHTML = assets.length
      ? assets.slice().reverse().map((asset) => `
        <article class="asset-card">
          <span class="asset-type">${escapeHtml(asset.type)}</span>
          <div><h3>${escapeHtml(asset.name)}</h3><p>${escapeHtml(asset.content)}</p><div class="tagline">${(asset.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></div>
          <button class="small-action danger-action" data-asset-delete="${escapeHtml(asset.id)}">移除</button>
        </article>`).join("")
      : `<p class="helper">还没有可复用资产。将角色立绘、场景、口头禅、冲突模板、标题模板、封面文案和 BGM/SFX 方案存入这里，生成时会作为项目上下文参考。</p>`;
  }

  function addAsset() {
    const name = $("#assetName").value.trim();
    const content = $("#assetContent").value.trim();
    if (!name || !content) throw new Error("请填写资产名称和可复用内容。");
    const project = currentProject();
    project.assets.push({
      id: newId("asset"),
      type: $("#assetType").value,
      name,
      content,
      tags: $("#assetTags").value.split(/[,，、\n]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
      createdAt: new Date().toISOString(),
    });
    ["assetName", "assetContent", "assetTags"].forEach((id) => setInputValue(id, ""));
    persistProjects();
    renderAssets();
    setStatus("已存入内容资产库");
  }

  function deleteAsset(id) {
    const project = currentProject();
    project.assets = (project.assets || []).filter((asset) => asset.id !== id);
    persistProjects();
    renderAssets();
    setStatus("已移除资产");
  }

  function renderConsistency() {
    const target = $("#consistencyOutput");
    if (!target) return;
    const report = currentProjectEpisode()?.consistency;
    if (!state.script) {
      target.innerHTML = `<p class="helper">请先生成或打开一集剧本，再执行一致性检查。</p>`;
      return;
    }
    if (!report) {
      target.innerHTML = `<p class="helper">当前集尚未检查。点击“检查当前集”会核对角色性格、精灵能力、人物关系和上一集悬念承接。</p>`;
      return;
    }
    const checks = Array.isArray(report.checks) ? report.checks : [];
    target.innerHTML = `
      <div class="consistency-summary">
        <div><h3>${escapeHtml(report.summary || "一致性检查完成")}</h3><p>下一集必须保留：${escapeHtml((report.mustPreserve || []).join("；") || "无额外要求")}</p></div>
        <span class="consistency-score">${escapeHtml(report.score ?? "-")}</span>
      </div>
      <div class="consistency-list">${checks.map((check) => `
        <article class="consistency-item">
          <strong>${escapeHtml(check.area || "检查项")}</strong>
          <div><span class="check-status ${escapeHtml(check.status || "warn")}">${escapeHtml(check.status || "warn")}</span><p>${escapeHtml(check.evidence || "")}</p><p>修正建议：${escapeHtml(check.fix || "无需修正")}</p></div>
        </article>`).join("")}</div>
      ${report.nextEpisodeCarryover ? `<section class="content-block"><h3>下一集承接提示</h3><p>${escapeHtml(report.nextEpisodeCarryover)}</p></section>` : ""}`;
  }

  async function runContinuityCheck() {
    if (!state.script) throw new Error("请先生成或恢复一个剧本，再检查一致性。");
    const operation = beginAiOperation("一致性检查");
    try {
      setStatus("AI 正在检查连载一致性...");
      const input = generationContext({ ...getInput(), script: state.script });
      const response = await apiRequest("/api/continuity-check", { input });
      assertActiveAiOperation(operation);
      const episode = currentProjectEpisode();
      if (episode) {
        const version = activeEpisodeVersion(episode);
        if (version) version.consistency = response.result;
        applyEpisodeVersion(episode, version?.id);
        episode.updatedAt = new Date().toISOString();
        persistProjects();
      }
      renderConsistency();
      renderProject();
      switchTab("consistency");
      setStatus(`一致性检查完成 ${nowTime()} · ${response.model || "deepseek"}${usageSuffix(response)}`);
    } finally {
      endAiOperation(operation);
    }
  }

  function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null) return;
    if (el.tagName === "SELECT" && !Array.from(el.options).some((option) => option.value === String(value))) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = String(value).slice(0, 80);
      el.appendChild(option);
    }
    el.value = value;
  }

  function topicPrompt(topic) {
    return [
      `选题：${topic.title}`,
      `剧情卖点：${topic.sellingPoint}`,
      `目标人群：${topic.audience}`,
      topic.roles ? `推荐角色：${topic.roles}` : "",
      topic.world ? `场景设定：${topic.world}` : "",
      `核心情绪：${topic.emotion}`,
      `关键反转：${topic.reversal}`,
      topic.memeLine ? `热梗台词：${topic.memeLine}` : "",
      topic.series ? "按连续短剧结构处理，结尾必须留下一集钩子。" : "优先做成单集强反转短剧。",
    ].filter(Boolean).join("\n");
  }

  function applyTopicToInputs(topic) {
    state.selectedTopic = topic;
    setInputValue("customScene", "");
    setInputValue("customDirection", "");
    setInputValue("customAudience", "");
    setInputValue("customDuration", "");
    setInputValue("theme", topic.title);
    if (topic.roles) setInputValue("roles", topic.roles);
    if (topic.world) setInputValue("scene", topic.world);
    setInputValue("direction", topicPrompt(topic));
    setInputValue("audience", topic.audience);
    setInputValue("duration", topic.duration);
  }

  function focusEpisodePlanning() {
    switchTab("script");
    const panel = document.querySelector(".episode-plan-panel");
    panel?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    window.setTimeout(() => $("#suggestPlansBtn")?.focus(), 180);
  }

  function prepareTopicPlanning(index, mode = "new") {
    const topic = state.topics[index];
    if (!topic) throw new Error("没有找到这个选题，请先重新生成选题库。");
    if (mode === "continue" && !state.script) throw new Error("还没有可续写的剧本，请先生成或恢复上一集。");
    applyTopicToInputs(topic);
    applyEpisodePlan({});
    state.planOptions = [];
    state.selectedPlanOptionId = null;
    renderPlanSuggestions();
    if (mode === "new") {
      state.currentEpisodeId = null;
      state.reviewEpisodeId = null;
      state.currentHistoryId = null;
      state.script = null;
      state.storyboard = [];
      state.creativePack = null;
      renderScript();
      renderStoryboard();
      renderCreativePack();
      renderConsistency();
    } else {
      setInputValue(
        "continueInstruction",
        [
          "沿着这个选题继续生成下一集，不要重写上一集。",
          topicPrompt(topic),
          "承接当前剧本结尾钩子，升级冲突，保留同一组核心角色。",
        ].join("\n"),
      );
    }
    saveDraft(false);
    focusEpisodePlanning();
    setStatus(mode === "continue"
      ? `已选择“${topic.title}”，请先确定下一集策划，再点击“续写下一集”`
      : `已选择“${topic.title}”，请先确定本集策划，再生成剧本`);
  }

  function normalizeTopicList(topics) {
    return (Array.isArray(topics) ? topics : [])
      .map((topic, index) => ({
        title: String(topic.title || "").trim(),
        sellingPoint: String(topic.sellingPoint || topic.selling_point || "").trim(),
        audience: String(topic.audience || topic.targetAudience || "洛克王国短剧用户").trim(),
        roles: String(topic.roles || topic.recommendedRoles || topic.roleLine || "").trim(),
        world: String(topic.world || topic.location || topic.scene || "").trim(),
        emotion: String(topic.emotion || topic.emotionPoint || "悬疑、怀旧").trim(),
        reversal: String(topic.reversal || topic.reversalPoint || "").trim(),
        memeLine: String(topic.memeLine || topic.meme_line || topic.hotMeme || "").trim(),
        duration: [45, 60, 75, 90].includes(Number(topic.duration)) ? Number(topic.duration) : 60,
        series: topic.series !== false,
        priority: ["S", "A", "B"].includes(String(topic.priority || "").toUpperCase())
          ? String(topic.priority).toUpperCase()
          : index < 3
            ? "S"
            : "A",
      }))
      .filter((topic) => topic.title && topic.sellingPoint && topic.reversal);
  }

  function fallbackTopics(count = 8) {
    state.topicBatch += 1;
    const input = getInput();
    const userMemes = String(input.memeSeed || "")
      .split(/[，,、；;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const memePool = [
      ...userMemes,
      "邪修",
      "外耗",
      "丝瓜汤文学",
      "爱你老己",
      "望周知",
      "来都来了",
      "谁懂啊",
      "这合理吗",
      "哪来的退堂鼓",
      "直接开大",
      "已读乱回",
      "班味太重",
      "不嘻嘻",
    ];
    const memeOffset = Math.floor(Math.random() * memePool.length);
    const audiencePool = [
      input.audience,
      "爱看抽象整活的学生党",
      "喜欢游戏二创和反差梗的泛娱乐用户",
      "下班刷短剧解压的打工人",
      "洛克王国老玩家里的搞笑党",
      "喜欢弹幕吐槽和嘴替台词的年轻用户",
      "亲子一起看也能笑的轻剧情用户",
      "只想看强钩子和爽反转的短剧用户",
    ].filter(Boolean);
    const audienceOffset = Math.floor(Math.random() * audiencePool.length);
    const pickAudience = (offset = 0) => audiencePool[(state.topicBatch + audienceOffset + offset) % audiencePool.length];
    const pickMeme = (offset = 0) => memePool[(state.topicBatch + memeOffset + offset) % memePool.length];
    const petCasts = [
      {
        roles: "阿洛：月牙镇新手洛克；喵喵：草系初始精灵，表面乖巧但很会吐槽；魔力猫：突然接管路线规划的进化形态",
        world: "月牙镇",
      },
      {
        roles: "可丽：普拉塔草原实习训练师；火花：火系初始精灵，动不动就想直接开大；火神：被误认为区域首领的进化形态",
        world: "普拉塔草原",
      },
      {
        roles: "小澈：怕水但嘴硬的小洛克；水蓝蓝：水系初始精灵，治愈系但会冷脸补刀；翡翠水母：浪花基地的异常信号源",
        world: "海上浪花基地",
      },
      {
        roles: "鹿眠：聆风塔巡查员；皇家狮鹫：高傲飞行精灵，嘴上嫌弃但每次救场；眠枭之星：塔顶风眼里的谜题精灵",
        world: "聆风塔地上区域",
      },
      {
        roles: "棋棋：会预判弹幕的精灵军师；棋绮后：棋盘女王形态，专治各种乱出牌；旧飞艇导航仪：故障冲突源",
        world: "旧飞艇航道",
      },
      {
        roles: "路路：迷路体质的小洛克；白发路路：未来形态，知道所有失败结局；书魔虫：藏在塔底旧档案里的情报商",
        world: "聆风塔地下区域",
      },
      {
        roles: "果冻：整活系训练师；呱呱：功夫精灵，专门打断反派吟唱；熊猫拳宗：风眠圣所的隐居师父",
        world: "风眠圣所",
      },
      {
        roles: "雪梨：收集控小洛克；雪影娃娃：冰系人气精灵，冷脸但护短；幽兰雪魅：风熄山口雪夜里的进阶形态",
        world: "风熄山口",
      },
      {
        roles: "洛奇：机械宅小洛克；立方人：逻辑过载的机械精灵；先锋君主：旧飞艇零件里的机械审判者",
        world: "旧飞艇航道",
      },
      {
        roles: "南瓜：胆小但爱看热闹的小洛克；小灵灵：幽灵系捣蛋精灵；九幽菇：沉船漩涡木板下长出的怪谈精灵",
        world: "沉船漩涡",
      },
    ];
    const castOffset = Math.floor(Math.random() * petCasts.length);
    const pickCast = (offset = 0) => petCasts[(state.topicBatch + castOffset + offset) % petCasts.length];
    const pool = [
      ["初始精灵互换身体，月牙镇全员不嘻嘻了", "把喵喵/火花/水蓝蓝的属性错位做成群像喜剧，天然适合连续剧", "荒诞、好笑、混乱", "互换不是魔法事故，而是图鉴在测试谁才配当主角", 60, true, "阿洛：被三只初始精灵追着吐槽的新手；喵喵：草系嘴替；火花：火系行动派；水蓝蓝：冷脸治愈系", "月牙镇"],
      ["雪影娃娃在风熄山口开了冷脸邪修班", "冰系人气精灵+邪修梗，画面和台词都容易出爆点", "冷幽默、反差、护短", "所谓冷脸训练，是为了冻结异常风眼里的记忆篡改", 60, true, "雪梨：收集控小洛克；雪影娃娃：冰系人气精灵，冷脸护短；幽兰雪魅：雪夜出现的进阶形态", "风熄山口"],
      ["皇家狮鹫被迫当代驾，聆风塔直接外耗", "高傲飞行精灵落到生活化整活场景，反差强", "好笑、速度感、救场", "它不是迷路，是故意绕开会吞掉飞行精灵的风眼", 45, true, "鹿眠：聆风塔巡查员；皇家狮鹫：高傲飞行精灵，嘴硬但救场；眠枭之星：塔顶风眼里的谜题精灵", "聆风塔地上区域"],
      ["书魔虫开始已读乱回，聆风塔地下炸了", "塔底档案怪谈+社交梗，低成本但悬疑感强", "好奇、惊悚、嘴替", "乱回的每一句都是未来失败结局的截图", 60, true, "路路：迷路体质的小洛克；书魔虫：藏在塔底旧档案里的情报商；古卷匣魔像：会吞掉错误剧情的守门者", "聆风塔地下区域"],
      ["呱呱打断风眠圣所吟唱，弹幕沉默三秒", "功夫精灵做喜剧救场，动作戏和梗台词兼具", "爽感、搞笑、反杀", "呱呱不是乱打，它听见了咒语里的玩家名字", 45, true, "果冻：整活系训练师；呱呱：功夫精灵，专门打断反派吟唱；熊猫拳宗：风眠圣所的隐居师父", "风眠圣所"],
      ["立方人算出旧飞艇全员都在内耗", "机械精灵+数据吐槽，适合做信息流字幕梗", "理性崩坏、反差、解压", "计算结果显示真正的 Bug 是训练师的童年遗憾", 60, true, "洛奇：机械宅小洛克；立方人：逻辑过载的机械精灵；先锋君主：旧飞艇零件里的机械审判者", "旧飞艇航道"],
      ["小灵灵把沉船漩涡整成弹幕直播间", "幽灵系整活+沉船怪谈，适合做夜间系列", "怪诞、好笑、悬疑", "弹幕不是观众发的，而是失踪精灵的求救信号", 75, true, "南瓜：胆小但爱看热闹的小洛克；小灵灵：幽灵系捣蛋精灵；九幽菇：沉船木板下长出的怪谈精灵", "沉船漩涡"],
      ["世界任务发布望周知：禁止召唤童年精灵", "公告体热梗+禁忌规则，封面强冲突", "好奇、压迫、反抗", "禁令是为了防止旧契约集体觉醒", 75, true],
      ["最弱精灵直接开大，区域首领沉默", "弱者逆袭爽点明确，台词可做成表情包传播", "爽感、燃、反差", "它不是最弱，是一直被系统限制输出", 60, true],
      ["探索背包已读乱回，吓醒老玩家", "把社交软件梗嫁接开放世界背包，低成本好拍", "好奇、惊喜、怀旧", "乱回的不是系统，是被困在探索点里的第一只精灵", 45, true],
      ["谁把区域任务整出班味了", "职场梗+开放世界探索，适合打工人和学生党双圈层", "疲惫、爆笑、反抗", "班味来自异常任务链植入的 KPI", 60, true],
      ["丝瓜汤文学拯救了黑化精灵", "温柔废话文学反差拯救黑化，结尾可催泪", "治愈、离谱、温柔", "黑化精灵只是不知道怎么说想你了", 75, true],
    ];
    const used = new Set(state.topics.map((topic) => topic.title));
    const start = state.topicBatch % pool.length;
    const rotated = [...pool.slice(start), ...pool.slice(0, start)];
    return rotated
      .filter((item) => !used.has(item[0]))
      .slice(0, count)
      .map((item, index) => ({
        roles: item[6] || pickCast(index).roles,
        world: item[7] || pickCast(index).world,
        title: item[0],
        sellingPoint: item[1],
        audience: pickAudience(index),
        emotion: item[2],
        reversal: item[3],
        memeLine: `${pickMeme(index)}：${["这合理吗？不合理，但洛克王国先合理了。", "别内耗了，今天开始外耗暗影博士。", "望周知，本集不是回忆杀，是童年反杀。", "来都来了，先把宠物救了再说。"][index % 4]}`,
        duration: item[4],
        series: item[5],
        priority: index < 2 ? "S" : index < 5 ? "A" : "B",
      }));
  }

  function refreshTopicDerivedViews() {
    state.creativePack = window.RocoStudio.generateCreativePack(state.script, getInput(), state.topics);
    state.calendar = window.RocoStudio.generatePublishPlan(state.topics, state.analysis);
    renderTopics();
    renderCreativePack();
    renderCalendar();
    renderExample();
    saveDraft(false);
  }

  async function regenerateTopics() {
    const operation = beginAiOperation("选题生成");
    const input = getInput();
    setStatus("AI 正在换一批选题...");
    try {
      const response = await apiRequest("/api/topics", {
        input: {
          ...input,
          count: 8,
          mode: "batch",
          competitorInsights: state.analysis ? state.analysis.summary : "",
          topicReference: $("#topicReference") ? $("#topicReference").innerText.trim() : "",
          existingTopics: state.topics,
        },
      });
      assertActiveAiOperation(operation);
      const topics = normalizeTopicList(response.result?.topics);
      if (!topics.length) throw new Error("AI 没有返回可用选题");
      state.topics = topics;
      refreshTopicDerivedViews();
      switchTab("topics");
      setStatus(`AI 已换一批选题 ${nowTime()} · ${response.model || "model"}${usageSuffix(response)}`);
    } catch (error) {
      const topics = fallbackTopics(8);
      if (!topics.length) throw error;
      state.topics = topics;
      refreshTopicDerivedViews();
      switchTab("topics");
      setStatus(`AI 换题失败，已用本地备选换一批：${error.message}`, true);
    } finally {
      endAiOperation(operation);
    }
  }

  async function replaceTopic(index) {
    const oldTopic = state.topics[index];
    if (!oldTopic) throw new Error("没有找到要替换的选题。");
    const operation = beginAiOperation("选题替换");
    setStatus("AI 正在替换这条选题...");
    try {
      const response = await apiRequest("/api/topics", {
        input: {
          ...getInput(),
          count: 1,
          mode: "replace",
          replaceTopic: oldTopic,
          competitorInsights: state.analysis ? state.analysis.summary : "",
          topicReference: $("#topicReference") ? $("#topicReference").innerText.trim() : "",
          existingTopics: state.topics,
        },
      });
      assertActiveAiOperation(operation);
      const topics = normalizeTopicList(response.result?.topics);
      if (!topics.length) throw new Error("AI 没有返回可用替换选题");
      state.topics.splice(index, 1, topics[0]);
      refreshTopicDerivedViews();
      setStatus(`已替换 1 条选题 ${nowTime()} · ${response.model || "model"}${usageSuffix(response)}`);
    } catch (error) {
      const topics = fallbackTopics(1);
      if (!topics.length) throw error;
      state.topics.splice(index, 1, topics[0]);
      refreshTopicDerivedViews();
      setStatus(`AI 替换失败，已用本地备选替换：${error.message}`, true);
    } finally {
      endAiOperation(operation);
    }
  }

  async function apiRequest(path, payload) {
    return apiClient.request(path, payload);
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function resolveAiJob(response, label) {
    if (!response.async || !response.jobId) return response;
    const startedAt = Date.now();
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await sleep(attempt < 2 ? 1200 : 2000);
      const job = await apiRequest(`/api/job?id=${encodeURIComponent(response.jobId)}`);
      if (job.status === "done") {
        return {
          ok: true,
          source: job.source || response.source,
          model: job.model || response.model,
          result: job.result,
        };
      }
      if (job.status === "error") {
        const error = new Error(job.error || `${label}生成失败`);
        error.code = job.code || "JOB_ERROR";
        throw error;
      }
      const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      setStatus(`${label}生成中... ${seconds}秒`);
    }
    throw new Error(`${label}仍在生成中，请稍后重试或缩短输入。`);
  }

  function normalizeGeneratedResult(result) {
    if (!result || !result.script || !Array.isArray(result.storyboard)) {
      throw new Error("AI 返回结构不完整，缺少 script 或 storyboard");
    }
    const script = result.script;
    script.characters = Array.isArray(script.characters) ? script.characters : [];
    script.structure = Array.isArray(script.structure) ? script.structure : [];
    script.dialogue = Array.isArray(script.dialogue) ? script.dialogue : [];
    script.rhythm = Array.isArray(script.rhythm) ? script.rhythm : [];
    script.reversals = Array.isArray(script.reversals) ? script.reversals : [];
    script.hooks = Array.isArray(script.hooks) ? script.hooks : [];
    script.tags = Array.isArray(script.tags) ? script.tags : [];
    return {
      script,
      storyboard: result.storyboard.map((shot, index) => ({
        shot: shot.shot || index + 1,
        seconds: shot.seconds || "",
        visual: shot.visual || "",
        characters: shot.characters || "",
        scene: shot.scene || "",
        action: shot.action || "",
        line: shot.line || "",
        scale: shot.scale || "",
        movement: shot.movement || "",
        sound: shot.sound || "",
        subtitle: shot.subtitle || "",
        visualPrompt: shot.visualPrompt || "",
        assetLinks: shot.assetLinks || "",
        assetNote: shot.assetNote || "",
        assetStatus: shot.assetStatus || "待准备",
      })),
      creativePack: result.creativePack || null,
    };
  }

  function normalizeScriptResult(result) {
    const script = result && (result.script || result);
    if (!script || typeof script !== "object") {
      throw new Error("AI 没有返回可用剧本");
    }
    script.characters = Array.isArray(script.characters) ? script.characters : [];
    script.structure = Array.isArray(script.structure) ? script.structure : [];
    script.dialogue = Array.isArray(script.dialogue) ? script.dialogue : [];
    script.rhythm = Array.isArray(script.rhythm) ? script.rhythm : [];
    script.reversals = Array.isArray(script.reversals) ? script.reversals : [];
    script.hooks = Array.isArray(script.hooks) ? script.hooks : [];
    script.tags = Array.isArray(script.tags) ? script.tags : [];
    return { script, storyboard: [], creativePack: null };
  }

  function normalizeStoryboardResult(result) {
    const storyboard = Array.isArray(result?.storyboard) ? result.storyboard : Array.isArray(result) ? result : [];
    if (!storyboard.length) {
      throw new Error("AI 没有返回可用分镜");
    }
    return storyboard.map((shot, index) => ({
      shot: shot.shot || index + 1,
      seconds: shot.seconds || "",
      visual: shot.visual || "",
      characters: shot.characters || "",
      scene: shot.scene || "",
      action: shot.action || "",
      line: shot.line || "",
      scale: shot.scale || "",
      movement: shot.movement || "",
      sound: shot.sound || "",
      subtitle: shot.subtitle || "",
      visualPrompt: shot.visualPrompt || "",
      assetLinks: shot.assetLinks || "",
      assetNote: shot.assetNote || "",
      assetStatus: shot.assetStatus || "待准备",
    }));
  }

  function renderEmptyStudio() {
    const input = getInput();
    $("#scriptTitle").textContent = "开始一集短剧";
    $("#scriptOutput").innerHTML = uiTemplates.emptyStudio(input);
  }

  function renderScript() {
    refreshCreationActions();
    const script = state.script;
    if (!script) {
      renderEmptyStudio();
      return;
    }
    $("#scriptTitle").textContent = script.title;
    $("#scriptOutput").innerHTML = uiTemplates.script(script);
  }

  function renderTable(target, rows, columns) {
    target.innerHTML = uiTemplates.table(rows, columns);
  }

  function renderStoryboard() {
    refreshCreationActions();
    $("#storyboardTable").innerHTML = uiTemplates.storyboard(state.storyboard, Boolean(state.script));
  }

  function updateStoryboardProductionField(index, field, value) {
    const shot = state.storyboard[index];
    if (!shot || !["assetLinks", "assetNote", "assetStatus"].includes(field)) return;
    shot[field] = value;
    const episode = currentProjectEpisode();
    const version = activeEpisodeVersion(episode);
    if (episode && version) {
      version.storyboard = state.storyboard;
      applyEpisodeVersion(episode, version.id);
      episode.updatedAt = new Date().toISOString();
      currentProject().updatedAt = new Date().toISOString();
      persistProjects();
    }
    saveDraft(false);
    setStatus("分镜制作状态已保存");
  }

  function topReferenceRows() {
    return [...(state.competitors || [])]
      .sort((a, b) => Number(b.viralScore || 0) - Number(a.viralScore || 0))
      .slice(0, 3);
  }

  function compactTextList(items, fallback) {
    const values = items.map((item) => String(item || "").trim()).filter(Boolean);
    return values.length ? values.join("；") : fallback;
  }

  function renderTopicReference() {
    const target = $("#topicReference");
    if (!target) return;
    const rows = topReferenceRows();
    const first = rows[0] || {};
    const topTitles = compactTextList(rows.map((row) => row.title), "暂无参考标题，先使用默认选题库。");
    const hitReasons = compactTextList(rows.map((row) => row.hitReason), "优先测试怀旧重逢、弱者逆袭、学院危机三类结构。");
    const feedback = compactTextList(rows.map((row) => row.feedback), "观察评论区是否出现“童年、想看下一集、我的第一只宠物”等催更词。");
    const recommendations = compactTextList(
      (state.analysis?.recommendations || []).slice(0, 3),
      "先测 60-80 秒连续短剧，开头 3 秒给异常提示，结尾留明确下一集问题。",
    );

    const cards = [
      ["优先参考", topTitles],
      ["可借钩子", hitReasons],
      ["评论需求", feedback],
      ["下一批测试", recommendations],
    ];

    target.innerHTML = `
      <div class="reference-summary">
        <div>
          <p class="eyebrow">选题参考</p>
          <h3>选题参考</h3>
          <p>根据${rows.length ? "爆款参考数据" : "默认样例"}提炼，只用于辅助判断，不占用主创作流程。</p>
        </div>
        <div class="reference-score">
          <strong>${escapeHtml(first.viralScore || "-")}</strong>
          <span>最高参考热度</span>
        </div>
      </div>
      <div class="reference-grid">
        ${cards
          .map(
            ([title, body]) => `
              <article class="reference-card">
                <h4>${escapeHtml(title)}</h4>
                <p>${escapeHtml(body)}</p>
              </article>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderHistory() {
    const target = $("#historyList");
    if (!target) return;
    target.innerHTML = uiTemplates.history(state.history);
  }

  async function loadHistory() {
    try {
      const stored = await archiveStore.get(historyKey);
      state.history = window.RocoWorkflowCore.hydrateHistory(stored, state.projects);
    } catch (error) {
      state.history = [];
    }
    const project = currentProject();
    if (project && !project.episodes.length && state.history.some((item) => !item.projectId && item.script)) {
      const legacyItems = state.history.slice().reverse();
      project.episodes = legacyItems.map((item, index) => {
        const episodeNumber = Math.max(1, Number(item.input?.episodeNumber) || index + 1);
        item.projectId = project.id;
        item.projectName = project.name;
        item.episodeNumber = episodeNumber;
        return {
          id: newId("episode"),
          episodeNumber,
          input: { ...(item.input || {}), episodeNumber },
          script: item.script,
          storyboard: item.storyboard || [],
          creativePack: item.creativePack || null,
          historyId: item.id,
          source: item.source || "",
          model: item.model || "",
          review: { status: "draft" },
          updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
        };
      });
      project.updatedAt = new Date().toISOString();
      normalizeProjectEpisodes(project);
      await persistHistory();
      await persistProjects();
    }
    renderHistory();
  }

  async function persistHistory() {
    try {
      const compact = window.RocoWorkflowCore.compactHistory(state.history.slice(0, maxHistoryItems));
      await archiveStore.set(historyKey, compact);
    } catch (error) {
      setStatus("生成记录保存失败：浏览器本地存储空间可能已满", true);
    }
  }

  function addHistoryItem({ mode, input, response, generated, projectId, projectName, episodeNumber }) {
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      createdAtText: new Date().toLocaleString("zh-CN", { hour12: false }),
      mode,
      source: response.source || "",
      model: response.model || "",
      input,
      script: generated.script,
      storyboard: generated.storyboard,
      creativePack: generated.creativePack,
      projectId: projectId || state.currentProjectId,
      projectName: projectName || currentProject()?.name || "未归档项目",
      episodeNumber: Number(episodeNumber || input.episodeNumber || 1),
      pinned: false,
    };
    state.history = [item, ...state.history].slice(0, maxHistoryItems);
    return item;
  }

  function updateCurrentHistoryStoryboard(response) {
    if (!state.currentHistoryId) return;
    const item = state.history.find((entry) => entry.id === state.currentHistoryId);
    if (!item) return;
    item.storyboard = state.storyboard;
    item.source = response.source || item.source || "";
    item.model = response.model || item.model || "";
    item.updatedAt = new Date().toISOString();
    persistHistory();
    renderHistory();
    updateCurrentProjectEpisodeStoryboard(response);
  }

  function restoreHistoryItem(index, keepInstruction = false) {
    const item = state.history[index];
    if (!item) throw new Error("没有找到这条生成记录。");
    Object.entries(item.input || {}).forEach(([key, value]) => {
      if (key === "continueInstruction" && keepInstruction) return;
      setInputValue(key, value);
    });
    applyEpisodePlan(item.input?.episodePlan);
    if (item.projectId && state.projects.some((project) => project.id === item.projectId)) {
      state.currentProjectId = item.projectId;
      const projectEpisode = currentProject()?.episodes?.find((episode) => episode.historyId === item.id);
      state.currentEpisodeId = projectEpisode?.id || null;
      state.reviewEpisodeId = state.currentEpisodeId;
    }
    state.script = item.script;
    state.storyboard = item.storyboard || [];
    state.creativePack = item.creativePack || null;
    state.currentHistoryId = item.id || null;
    renderProject();
    renderBible();
    renderAssets();
    renderScript();
    renderStoryboard();
    renderCreativePack();
    renderConsistency();
    renderExample();
    switchTab("script");
    saveDraft(false);
    setStatus(`已恢复记录：${item.script?.title || "未命名剧本"}`);
  }

  async function continueHistoryItem(index) {
    restoreHistoryItem(index, true);
    setInputValue(
      "continueInstruction",
      `基于已恢复的《${state.script?.title || "上一集"}》继续生成下一集，承接结尾钩子，保留核心角色关系，不要重写上一集。`,
    );
    await runGeneration("continue");
  }

  function toggleHistoryPin(index) {
    const item = state.history[index];
    if (!item) return;
    item.pinned = !item.pinned;
    persistHistory();
    renderHistory();
  }

  function deleteHistoryItem(index) {
    state.history.splice(index, 1);
    persistHistory();
    renderHistory();
    setStatus("已删除一条生成记录");
  }

  function renderCompetitors() {
    const insightTarget = $("#competitorInsights");
    const tableTarget = $("#competitorTable");
    if (!insightTarget || !tableTarget) return;
    const analysis = state.analysis;
    insightTarget.innerHTML = analysis
      ? [
          ["总体判断", analysis.summary],
          ["爆款共性", (analysis.findings || []).join("；")],
          ["下一步建议", (analysis.recommendations || []).join("；")],
        ]
          .map(
            ([title, body]) => `
              <div class="metric-card">
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(body)}</p>
              </div>
            `,
          )
          .join("")
      : `<p class="helper">点击“更新选题库”后显示。</p>`;

    renderTable(tableTarget, state.competitors, [
      { key: "accountName", label: "账号" },
      { key: "positioning", label: "定位" },
      { key: "title", label: "视频标题" },
      { key: "coverStyle", label: "封面风格" },
      { key: "publishTime", label: "发布时间" },
      { key: "likes", label: "点赞" },
      { key: "comments", label: "评论" },
      { key: "favorites", label: "收藏" },
      { key: "shares", label: "转发" },
      { key: "views", label: "播放" },
      { key: "interactionRate", label: "互动率" },
      { key: "saveShareRate", label: "藏转率" },
      { key: "viralScore", label: "热度分" },
      { key: "diagnosis", label: "诊断" },
      { key: "hitReason", label: "爆款特征" },
      { key: "feedback", label: "评论反馈" },
    ]);
  }

  function renderTopics() {
    renderTopicReference();
    $("#topicGrid").innerHTML = state.topics
      .map(
        (topic, index) => `
          <article class="topic-card">
            <h3>${escapeHtml(topic.title)}</h3>
            <p><strong>卖点：</strong>${escapeHtml(topic.sellingPoint)}</p>
            <p><strong>人群：</strong>${escapeHtml(topic.audience)}</p>
            ${topic.roles ? `<p><strong>角色：</strong>${escapeHtml(topic.roles)}</p>` : ""}
            ${topic.world ? `<p><strong>场景：</strong>${escapeHtml(topic.world)}</p>` : ""}
            <p><strong>情绪：</strong>${escapeHtml(topic.emotion)}</p>
            <p><strong>反转：</strong>${escapeHtml(topic.reversal)}</p>
            ${topic.memeLine ? `<p><strong>梗台词：</strong>${escapeHtml(topic.memeLine)}</p>` : ""}
            <div class="tagline">
              <span class="tag">${escapeHtml(topic.duration)}秒</span>
              <span class="tag">${topic.series ? "适合系列化" : "单集更合适"}</span>
              <span class="tag">优先级 ${escapeHtml(topic.priority)}</span>
            </div>
            <div class="topic-actions">
              <button class="small-action" data-topic-generate="${index}">选择并策划本集</button>
              <button class="small-action" data-topic-continue="${index}">策划这个方向的下一集</button>
              <button class="small-action" data-topic-replace="${index}">替换这条</button>
            </div>
          </article>
        `,
      )
      .join("");
  }

  function renderCreativePack() {
    const pack = state.creativePack;
    if (!pack) return;
    $("#creativeOutput").innerHTML = `
      <section class="content-block">
        <h3>标题 A/B 测试</h3>
        <div class="variant-list">
          ${pack.titleVariants
            .map(
              (item) => `
                <div class="variant-row">
                  <strong>${escapeHtml(item.type)}</strong>
                  <span>${escapeHtml(item.text)}</span>
                  <small>${escapeHtml(item.reason)}</small>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>
      <section class="content-block">
        <h3>封面方案</h3>
        <div class="variant-list">
          ${pack.coverVariants
            .map(
              (item) => `
                <div class="variant-row">
                  <strong>${escapeHtml(item.text)}</strong>
                  <span>${escapeHtml(item.visual)}</span>
                  <small>${escapeHtml(item.risk)}</small>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>
      ${renderList("前3秒钩子", pack.openingHooks)}
      ${renderList("评论区引导", pack.ctaLines)}
      ${renderList("发布前检查", pack.productionChecklist)}
    `;
  }

  function renderCalendar() {
    renderTable($("#calendarTable"), state.calendar, [
      { key: "day", label: "日期" },
      { key: "time", label: "发布时间" },
      { key: "title", label: "选题" },
      { key: "goal", label: "测试目标" },
      { key: "test", label: "A/B测试" },
      { key: "targetMetric", label: "观察指标" },
      { key: "nextAction", label: "次日动作" },
    ]);

    $("#reviewBoard").innerHTML = [
      ["首日判断", "发布后 2 小时先看 3 秒留存和评论关键词，不急着判定选题生死。"],
      ["三条判断", "同一题材至少测 3 条：标题、封面、开头分别替换，避免误杀好题材。"],
      ["一周判断", "按热度分、转粉率和催更评论决定保留角色，不只看点赞。"],
    ]
      .map(
        ([title, body]) => `
          <div class="metric-card">
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(body)}</p>
          </div>
        `,
      )
      .join("");
  }

  function renderExample() {
    const topic = state.topics[0];
    if (!state.script || !state.storyboard.length || !topic) return;
    const competitor = state.competitors[0];
    $("#exampleOutput").innerHTML = `
      <section class="content-block">
        <h3>选题</h3>
        <p><strong>${escapeHtml(topic.title)}</strong></p>
        <p>卖点：${escapeHtml(topic.sellingPoint)}；人群：${escapeHtml(topic.audience)}；情绪：${escapeHtml(topic.emotion)}；反转：${escapeHtml(topic.reversal)}。</p>
      </section>
      <section class="content-block">
        <h3>短剧剧本</h3>
        <p>${escapeHtml(state.script.synopsis)}</p>
      </section>
      <section class="content-block">
        <h3>对应分镜</h3>
        <p>共 ${state.storyboard.length} 个镜头，总时长 ${state.storyboard.reduce((sum, shot) => sum + Number(shot.seconds), 0)} 秒。首镜：${escapeHtml(state.storyboard[0].visual)}；尾镜：${escapeHtml(state.storyboard[state.storyboard.length - 1].subtitle)}。</p>
      </section>
      <section class="content-block">
        <h3>选题参考</h3>
        <p>参考高互动内容：${escapeHtml(competitor.title)}。可借用的方向：${escapeHtml(competitor.hitReason)}。</p>
      </section>
      <section class="content-block">
        <h3>后续优化建议</h3>
        <ul>
          <li>若 3 秒留存低，把首镜改成“契约失效”或“它等了我3652天”的大字弹窗。</li>
          <li>若评论区持续催更，下一集优先解释“旧契约徽章”的秘密。</li>
          <li>若收藏率高于转发率，增加宠物设定和隐藏任务信息量。</li>
        </ul>
      </section>
    `;
  }

  function renderSchema() {
    const target = $("#schemaGrid");
    if (!target) return;
    const constants = window.RocoStudio.constants;
    const groups = [
      ["账号表", constants.accountFields],
      ["视频表", constants.videoFields],
      ["评论表", constants.commentFields],
      ["选题库", constants.topicFields],
    ];

    target.innerHTML = groups
      .map(
        ([title, fields]) => `
          <article class="schema-card">
            <h3>${escapeHtml(title)}</h3>
            ${fields
              .map(
                (field) => `
                  <div class="field-row">
                    <code>${escapeHtml(field.key)}</code>
                    <span>${escapeHtml(field.label || field.description)}</span>
                  </div>
                `,
              )
              .join("")}
          </article>
        `,
      )
      .join("");
  }

  async function runGeneration(mode = "new") {
    const input = getInput();
    validateEpisodePlan(input);
    if (mode === "continue" && !state.script) {
      throw new Error("还没有可续写的剧本，请先生成一集。");
    }
    const operation = beginAiOperation(mode === "continue" ? "剧本续写" : "剧本生成");
    try {
      setStatus(mode === "continue" ? "AI 续写剧本中..." : "AI 生成剧本中...");
      if (mode === "continue") {
        const nextNumber = Math.max(Number(input.episodeNumber || 0) + 1, nextEpisodeNumber());
        input.episodeNumber = nextNumber;
        setInputValue("episodeNumber", nextNumber);
        state.currentEpisodeId = null;
      }
      const previousScript = mode === "continue" ? state.script : null;
      const previousStoryboard = mode === "continue" ? state.storyboard : null;
      const initialResponse = await apiRequest("/api/script", {
        input: {
          ...generationContext(input),
          mode,
          competitorInsights: state.analysis ? state.analysis.summary : "",
          previousScript,
          previousStoryboard,
        },
      });
      const response = await resolveAiJob(initialResponse, mode === "continue" ? "续写剧本" : "剧本");
      assertActiveAiOperation(operation);
      const generated = normalizeScriptResult(response.result);
      state.script = generated.script;
      state.storyboard = [];
      state.creativePack = window.RocoStudio.generateCreativePack(state.script, input, state.topics);
      const item = addHistoryItem({
        mode,
        input,
        response,
        projectId: state.currentProjectId,
        projectName: currentProject()?.name,
        episodeNumber: input.episodeNumber,
        generated: { ...generated, creativePack: state.creativePack },
      });
      state.currentHistoryId = item.id;
      upsertProjectEpisode({ mode, input, response, generated: { ...generated, creativePack: state.creativePack }, historyId: item.id });
      persistHistory();
      renderScript();
      renderStoryboard();
      renderCreativePack();
      renderHistory();
      renderConsistency();
      renderExample();
      saveDraft(false);
      pulseResult();
      switchTab("script");
      setStatus(
        `${mode === "continue" ? "AI 已续写剧本" : "AI 已生成剧本"} ${nowTime()} · ${response.source || "provider"} · ${response.model || "model"}${usageSuffix(response)}。满意后可点击“AI 生成分镜”。`,
      );
    } finally {
      endAiOperation(operation);
    }
  }

  async function generateStoryboardForCurrentScript() {
    if (!state.script) {
      throw new Error("请先生成或恢复一个剧本，再生成分镜。");
    }
    const operation = beginAiOperation("分镜生成");
    try {
      const input = getInput();
      const script = state.script;
      setStatus("AI 正在基于当前剧本生成分镜...");
      const initialResponse = await apiRequest("/api/storyboard", {
        input: {
          ...generationContext(input),
          script,
        },
      });
      const response = await resolveAiJob(initialResponse, "分镜");
      assertActiveAiOperation(operation);
      state.storyboard = normalizeStoryboardResult(response.result);
      updateCurrentHistoryStoryboard(response);
      renderStoryboard();
      renderConsistency();
      renderExample();
      saveDraft(false);
      pulseResult();
      switchTab("storyboard");
      setStatus(`AI 已生成分镜 ${nowTime()} · ${response.source || "provider"} · ${response.model || "model"}${usageSuffix(response)}`);
    } finally {
      endAiOperation(operation);
    }
  }

  async function generateAll() {
    await runGeneration("new");
  }

  async function continueEpisode() {
    await runGeneration("continue");
  }

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const parseLine = (line) => {
      const cells = [];
      let current = "";
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (char === '"') {
          quoted = !quoted;
        } else if (char === "," && !quoted) {
          cells.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      cells.push(current.trim());
      return cells;
    };
    const headers = parseLine(lines[0]);
    return lines.slice(1).map((line) => {
      const cells = parseLine(line);
      return headers.reduce((row, header, index) => {
        const value = cells[index] || "";
        row[header] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
        return row;
      }, {});
    });
  }

  function analyzeAll() {
    const api = window.RocoStudio;
    const imported = parseCsv($("#competitorCsv").value);
    state.competitors = api.scoreCompetitors(imported.length ? imported : api.seedCompetitors.slice());
    state.analysis = api.analyzeCompetitors(state.competitors);
    state.topics = api.generateTopics(state.competitors);
    state.creativePack = api.generateCreativePack(state.script, getInput(), state.topics);
    state.calendar = api.generatePublishPlan(state.topics, state.analysis);
    renderTopics();
    renderCreativePack();
    renderCalendar();
    renderExample();
    saveDraft(false);
    pulseResult();
    setStatus(`选题库已更新 ${nowTime()}`);
  }

  async function checkAiStatus() {
    try {
      const status = await apiRequest("/api/status");
      if (status.aiConnected) {
        const remaining = status.usage && !status.usage.unavailable
          ? Math.max(0, Number(status.usage.limit || 0) - Number(status.usage.usedUnits || 0))
          : null;
        setStatus(`AI 已连接 · ${status.provider || "provider"} · ${status.model}${Number.isFinite(remaining) ? ` · 今日剩余 ${remaining} 单位` : ""}`);
      } else {
        setStatus("AI 未连接：请检查 Cloudflare Worker 的 DeepSeek 密钥配置。", true);
      }
    } catch (error) {
      setStatus("未连接生成服务：请确认当前站点已部署到 Cloudflare Worker。", true);
    }
  }

  async function saveDraft(showStatus = true) {
    const payload = {
      input: getInput(),
      competitorCsv: $("#competitorCsv").value,
      currentHistoryId: state.currentHistoryId,
      currentProjectId: state.currentProjectId,
      currentEpisodeId: state.currentEpisodeId,
      topics: state.topics,
      analysis: state.analysis,
      competitors: state.competitors,
      savedAt: new Date().toISOString(),
    };
    try {
      await archiveStore.set(draftKey, payload);
      if (showStatus) setStatus("草稿已保存");
    } catch (error) {
      if (showStatus) setStatus("当前浏览器未开放本地保存", true);
    }
  }

  async function restoreDraft() {
    try {
      const draft = await archiveStore.get(draftKey);
      if (!draft) return;
      if (draft.currentProjectId && state.projects.some((project) => project.id === draft.currentProjectId)) {
        state.currentProjectId = draft.currentProjectId;
      }
      state.currentEpisodeId = draft.currentEpisodeId || null;
      state.reviewEpisodeId = state.currentEpisodeId;
      Object.entries(draft.input || {}).forEach(([key, value]) => {
        const el = document.getElementById(key);
        if (el) el.value = value;
      });
      applyEpisodePlan(draft.input?.episodePlan);
      $("#competitorCsv").value = draft.competitorCsv || "";
      state.topics = normalizeTopicList(draft.topics);
      state.analysis = draft.analysis || null;
      state.competitors = Array.isArray(draft.competitors) ? draft.competitors : [];
      const episode = currentProjectEpisode();
      if (episode) {
        applyEpisodeVersion(episode, episode.activeVersionId);
        state.script = episode.script || null;
        state.storyboard = Array.isArray(episode.storyboard) ? episode.storyboard : [];
        state.creativePack = episode.creativePack || null;
      } else {
        // Older drafts embedded content directly; keep this one-time migration fallback.
        state.script = draft.script || null;
        state.storyboard = Array.isArray(draft.storyboard) ? draft.storyboard : [];
        state.creativePack = draft.creativePack || null;
      }
      state.currentHistoryId = draft.currentHistoryId || null;
      setStatus("已恢复草稿");
    } catch (error) {
      // A malformed legacy draft is ignored; valid project archives remain intact.
    }
  }

  function switchTab(tabName) {
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
    $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${tabName}`));
    refreshToolbarState(tabName);
  }

  async function copyElementText(id) {
    const el = document.getElementById(id);
    const text = el.innerText.trim();
    try {
      await navigator.clipboard.writeText(text);
      setStatus("已复制");
    } catch (error) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      setStatus("已选中文本");
    }
  }

  function download(name, content, type = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportMarkdown() {
    const scriptText = $("#scriptOutput").innerText.trim();
    const storyboardText = $("#storyboardTable").innerText.trim();
    const topicsText = $("#topicGrid").innerText.trim();
    const creativeText = $("#creativeOutput").innerText.trim();
    const calendarText = $("#calendarTable").innerText.trim();
    const exampleText = $("#exampleOutput").innerText.trim();
    const markdown = [
      `# ${state.script ? state.script.title : "洛克王国短剧创作结果"}`,
      "",
      "## 剧本",
      scriptText,
      "",
      "## 分镜",
      storyboardText,
      "",
      "## 选题库",
      topicsText,
      "",
      "## 标题封面创意包",
      creativeText,
      "",
      "## 7天排期",
      calendarText,
      "",
      "## 完整示例",
      exampleText,
      "",
      "> 粉丝向二创工作台示例，不代表官方内容或授权关系。",
    ].join("\n");
    download("rock-kingdom-shortdrama.md", markdown, "text/markdown;charset=utf-8");
  }

  function historyItemMarkdown(item, index) {
    const storyboardText = (item.storyboard || [])
      .map(
        (shot) =>
          `${shot.shot}. ${shot.seconds || ""}秒｜${shot.visual || ""}｜${shot.line || ""}｜${shot.subtitle || ""}`,
      )
      .join("\n");
    return [
      `## ${index + 1}. ${item.script?.title || "未命名剧本"}`,
      "",
      `- 时间：${item.createdAtText || item.createdAt || ""}`,
      `- 类型：${item.mode === "continue" ? "续写" : "新生成"}`,
      `- 模型：${item.model || ""}`,
      `- 状态：${item.pinned ? "入围" : "未入围"}`,
      "",
      "### 梗概",
      item.script?.synopsis || "",
      "",
      "### 结尾钩子",
      (item.script?.hooks || []).map((hook) => `- ${formatItem(hook)}`).join("\n"),
      "",
      "### 分镜",
      storyboardText,
    ].join("\n");
  }

  function exportHistoryMarkdown() {
    if (!state.history.length) {
      setStatus("暂无生成记录可导出", true);
      return;
    }
    const markdown = [
      "# 洛克王国短剧生成记录",
      "",
      `导出时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
      "",
      ...state.history.map(historyItemMarkdown),
      "",
      "> 粉丝向二创工作台示例，不代表官方内容或授权关系。",
    ].join("\n");
    download("rock-kingdom-script-history.md", markdown, "text/markdown;charset=utf-8");
  }

  function clearHistory() {
    if (!state.history.length) return;
    const pinned = state.history.filter((item) => item.pinned);
    state.history = pinned;
    persistHistory();
    renderHistory();
    setStatus(pinned.length ? "已清空未入围记录，保留入围候选" : "已清空生成记录");
  }

  function bindEvents() {
    $("#newProjectBtn").addEventListener("click", createProject);
    $("#saveProjectBtn").addEventListener("click", saveProjectMeta);
    $("#exportProjectBtn").addEventListener("click", exportCurrentProject);
    $("#importProjectBtn").addEventListener("click", () => $("#importProjectFile").click());
    $("#importProjectFile").addEventListener("change", (event) => {
      importProjectFile(event.target.files?.[0]);
      event.target.value = "";
    });
    $("#saveBibleBtn").addEventListener("click", saveBible);
    $("#autoPlanBtn").addEventListener("click", () => autoFillEpisodePlan());
    $("#suggestPlansBtn").addEventListener("click", async () => {
      try {
        await suggestEpisodePlans();
      } catch (error) {
        reportError("本集策划生成", error);
      }
    });
    $("#planSuggestions").addEventListener("click", (event) => {
      const button = event.target.closest("[data-plan-option]");
      if (!button) return;
      try {
        adoptPlanOption(Number(button.dataset.planOption));
      } catch (error) {
        reportError("采用本集策划", error);
      }
    });
    ["planOpeningHook", "planConflict", "planReversal", "planEndingSuspense", "planTargetEmotion"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", refreshCreationActions);
    });
    $("#checkContinuityBtn").addEventListener("click", async () => {
      try {
        await runContinuityCheck();
      } catch (error) {
        reportError("一致性检查", error);
      }
    });
    $("#addAssetBtn").addEventListener("click", () => {
      try {
        addAsset();
      } catch (error) {
        reportError("资产入库", error);
      }
    });
    $("#projectSelect").addEventListener("change", (event) => {
      state.currentProjectId = event.target.value;
      resetCurrentCreation();
      renderProject();
      renderBible();
      renderAssets();
      renderConsistency();
      saveDraft(false);
      setStatus(`已切换到项目：${currentProject()?.name || "未命名项目"}`);
    });
    $("#reviewEpisodeSelect").addEventListener("change", (event) => {
      state.reviewEpisodeId = event.target.value;
      renderReviewForm();
    });
    $("#saveReviewBtn").addEventListener("click", () => {
      try {
        saveReview();
      } catch (error) {
        reportError("复盘保存", error);
      }
    });
    $("#generateBtn").addEventListener("click", async () => {
      try {
        await generateAll();
      } catch (error) {
        if (["NO_API_KEY", "NO_DEEPSEEK_KEY", "NO_PROVIDER"].includes(error.code)) {
          setStatus("AI 未连接：请检查 Cloudflare Worker 的 DeepSeek 密钥配置。", true);
          return;
        }
        reportError("生成", error);
      }
    });
    $("#storyboardBtn").addEventListener("click", async () => {
      try {
        await generateStoryboardForCurrentScript();
      } catch (error) {
        if (["NO_API_KEY", "NO_DEEPSEEK_KEY", "NO_PROVIDER"].includes(error.code)) {
          setStatus("AI 未连接：请检查 Cloudflare Worker 的 DeepSeek 密钥配置。", true);
          return;
        }
        reportError("分镜生成", error);
      }
    });
    $("#storyboardTable").addEventListener("change", (event) => {
      const field = event.target.dataset.shotField;
      const index = Number(event.target.dataset.shotIndex);
      if (!field || Number.isNaN(index)) return;
      updateStoryboardProductionField(index, field, event.target.value);
    });
    $("#continueBtn").addEventListener("click", async () => {
      try {
        await continueEpisode();
      } catch (error) {
        if (["NO_API_KEY", "NO_DEEPSEEK_KEY", "NO_PROVIDER"].includes(error.code)) {
          setStatus("AI 未连接：请检查 Cloudflare Worker 的 DeepSeek 密钥配置。", true);
          return;
        }
        reportError("续写", error);
      }
    });
    $("#scriptOutput").addEventListener("click", async (event) => {
      const generateButton = event.target.closest("[data-empty-generate]");
      const topicsButton = event.target.closest("[data-empty-topics]");
      if (!generateButton && !topicsButton) return;
      try {
        if (generateButton) await generateAll();
        if (topicsButton) switchTab("topics");
      } catch (error) {
        reportError(generateButton ? "生成" : "切换选题库", error);
      }
    });
    $("#analyzeBtn").addEventListener("click", () => {
      try {
        analyzeAll();
      } catch (error) {
        reportError("分析", error);
      }
    });
    $("#saveDraftBtn").addEventListener("click", () => saveDraft(true));
    $("#exportBtn").addEventListener("click", exportMarkdown);
    const competitorDownload = $("#downloadCompetitors");
    if (competitorDownload) {
      competitorDownload.addEventListener("click", () => {
        download("reference-videos.csv", window.RocoStudio.toCsv(state.competitors), "text/csv;charset=utf-8");
      });
    }
    $("#downloadTopics").addEventListener("click", () => {
      download("topics.csv", window.RocoStudio.toCsv(state.topics), "text/csv;charset=utf-8");
    });
    $("#regenerateTopicsBtn").addEventListener("click", async () => {
      try {
        await regenerateTopics();
      } catch (error) {
        reportError("换选题", error);
      }
    });
    $("#downloadCalendar").addEventListener("click", () => {
      download("publish-plan.csv", window.RocoStudio.toCsv(state.calendar), "text/csv;charset=utf-8");
    });
    $("#exportHistoryBtn").addEventListener("click", exportHistoryMarkdown);
    $("#clearHistoryBtn").addEventListener("click", clearHistory);
    $$(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
    $("#historyList").addEventListener("click", async (event) => {
      const restoreButton = event.target.closest("[data-history-restore]");
      const continueButton = event.target.closest("[data-history-continue]");
      const pinButton = event.target.closest("[data-history-pin]");
      const deleteButton = event.target.closest("[data-history-delete]");
      if (!restoreButton && !continueButton && !pinButton && !deleteButton) return;
      try {
        if (restoreButton) restoreHistoryItem(Number(restoreButton.dataset.historyRestore));
        if (continueButton) await continueHistoryItem(Number(continueButton.dataset.historyContinue));
        if (pinButton) toggleHistoryPin(Number(pinButton.dataset.historyPin));
        if (deleteButton) deleteHistoryItem(Number(deleteButton.dataset.historyDelete));
      } catch (error) {
        reportError("生成记录", error);
      }
    });
    $("#projectEpisodeList").addEventListener("click", (event) => {
      const restoreButton = event.target.closest("[data-project-episode-restore]");
      const reviewButton = event.target.closest("[data-project-episode-review]");
      const versionButton = event.target.closest("[data-project-episode-version]");
      try {
        if (restoreButton) restoreProjectEpisode(restoreButton.dataset.projectEpisodeRestore);
        if (versionButton) restoreProjectEpisode(versionButton.dataset.projectEpisodeVersion, versionButton.dataset.projectVersionId);
        if (reviewButton) {
          state.reviewEpisodeId = reviewButton.dataset.projectEpisodeReview;
          renderReviewForm();
          document.getElementById("reviewEpisodeSelect")?.focus();
        }
      } catch (error) {
        reportError("项目集数", error);
      }
    });
    $("#assetLibrary").addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-asset-delete]");
      if (!deleteButton) return;
      deleteAsset(deleteButton.dataset.assetDelete);
    });
    $("#topicGrid").addEventListener("click", async (event) => {
      const generateButton = event.target.closest("[data-topic-generate]");
      const continueButton = event.target.closest("[data-topic-continue]");
      const replaceButton = event.target.closest("[data-topic-replace]");
      if (!generateButton && !continueButton && !replaceButton) return;
      try {
        if (generateButton) prepareTopicPlanning(Number(generateButton.dataset.topicGenerate), "new");
        if (continueButton) prepareTopicPlanning(Number(continueButton.dataset.topicContinue), "continue");
        if (replaceButton) await replaceTopic(Number(replaceButton.dataset.topicReplace));
      } catch (error) {
        reportError(generateButton ? "选择本集选题" : continueButton ? "选择续写选题" : "替换选题", error);
      }
    });
    $$("[data-copy]").forEach((button) => {
      button.addEventListener("click", () => copyElementText(button.dataset.copy));
    });
  }

  async function init() {
    if (!window.RocoStudio || !window.RocoWorkflowCore || !window.RocoProjectDomain || !window.RocoEpisodePlanner || !window.RocoUiTemplates || !window.RocoApiClient || !window.RocoDataStore) {
      setStatus("生成器未加载，请用本地服务打开或刷新缓存", true);
      return;
    }
    try {
      bindEvents();
      await loadProjects();
      await restoreDraft();
      await loadHistory();
      if (state.topics.length) {
        refreshTopicDerivedViews();
      } else {
        analyzeAll();
      }
      renderScript();
      renderStoryboard();
      renderCreativePack();
      renderProject();
      renderBible();
      renderAssets();
      renderConsistency();
      renderExample();
      checkAiStatus();
    } catch (error) {
      reportError("初始化", error);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("error", (event) => {
    reportError("脚本", event.error || event.message);
  });
})();
