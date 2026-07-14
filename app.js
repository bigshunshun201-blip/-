(function () {
  const { aiModelScopes, defaultAiModels, aiModelScopeLabels } = window.RocoAppState;
  const state = window.RocoAppState.createState();

  const draftKey = "roco-shortdrama-studio-draft";
  const historyKey = "roco-shortdrama-studio-history";
  const projectsKey = "roco-shortdrama-studio-projects";
  const accessCodeKey = "roco-shortdrama-access-code";
  const maxHistoryItems = 60;
  const apiTimeoutMs = 600_000;
  const characterFieldIds = ["characterName", "characterRole", "characterTraits", "characterContrast", "characterDesire", "characterWeakness", "characterCatchphrases", "characterMannerism", "characterComedyTrigger", "characterBoundary", "characterSpeechPattern", "characterPressureResponse", "characterLieTell", "characterAddressStyle", "characterForbiddenPhrases", "characterInnerNeed", "characterWound", "characterSecret"];
  const apiClient = window.RocoApiClient.create({ accessCodeKey, timeoutMs: apiTimeoutMs });
  const generationClient = window.RocoGenerationClient.create({
    apiClient,
    onProgress: ({ label, seconds }) => setStatus(`${label}生成中... ${seconds}秒`),
  });
  const archiveStore = window.RocoDataStore.create();
  const archiveSync = window.RocoArchiveSync.create({
    store: archiveStore,
    apiClient,
    projectsKey,
    accessCodeStorageKey: accessCodeKey,
    onStatus: (status) => {
      state.cloudArchive = { ...state.cloudArchive, ...status };
      renderCloudArchive();
    },
    onConflict: (error) => {
      setSaveState("error");
      setStatus(error.message, true);
    },
  });
  let projectWriteRevision = 0;
  let persistedProjectRevision = 0;

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
  const applyStoryboardVersion = projectDomain.applyStoryboardVersion;
  const normalizeProjectEpisodes = projectDomain.normalizeProjectEpisodes;
  const validateEpisodePlan = projectDomain.validateEpisodePlan;
  const deriveReviewInsights = projectDomain.deriveReviewInsights;
  const episodePlanner = window.RocoEpisodePlanner;
  const uiTemplates = window.RocoUiTemplates;
  const escapeHtml = uiTemplates.escapeHtml;
  const formatItem = uiTemplates.formatItem;
  const renderList = uiTemplates.renderList;
  const aiOperations = window.RocoAiOperation.create({
    state,
    newId,
    getProjectId: () => state.currentProjectId,
    getContextToken: () => JSON.stringify({
      projectId: state.currentProjectId,
      episodeId: state.currentEpisodeId,
      historyId: state.currentHistoryId,
      input: getInput(),
      script: state.script ? { title: state.script.title, synopsis: state.script.synopsis } : null,
    }),
    onChange: () => refreshCreationActions(),
  });

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

  function setSaveState(status) {
    const target = $("#saveStateText");
    if (!target) return;
    const labels = { saving: "正在保存", saved: "已保存", error: "保存失败" };
    target.textContent = labels[status] || "";
    target.dataset.state = status;
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
    const hasApprovedBeatSheet = state.beatSheetApproved && state.beatSheet.length === 8;
    const isContinuation = Boolean(state.continuationSource);
    const generateButton = $("#generateBtn");
    const storyboardButton = $("#storyboardBtn");
    const continueButton = $("#continueBtn");
    const beatSheetButton = $("#generateBeatSheetBtn");
    const planReadyState = $("#planReadyState");
    const stage = $(".stage");

    if (generateButton) {
      generateButton.disabled = isBusy || !hasCompletePlan || !hasApprovedBeatSheet;
      generateButton.textContent = !hasCompletePlan ? "先完成本集策划" : !hasApprovedBeatSheet ? "先确认剧情节拍表" : isContinuation ? "生成下一集剧本" : "生成本集剧本";
      generateButton.title = hasCompletePlan && hasApprovedBeatSheet ? "根据已确认的本集策划和节拍表生成剧本" : "请先完成本集策划，并生成、确认一版剧情节拍表";
    }
    if (planReadyState) {
      planReadyState.textContent = !hasCompletePlan ? "请先完整填写或采用一套本集策划" : !hasApprovedBeatSheet ? "策划已完成，请生成并确认剧情节拍表" : "策划和节拍表已就绪，可以生成剧本";
      planReadyState.classList.toggle("is-ready", hasCompletePlan && hasApprovedBeatSheet);
    }
    if (storyboardButton) {
      storyboardButton.disabled = isBusy || !hasScript;
      storyboardButton.title = hasScript ? "仅根据当前剧本版本，按所选视频分段模式生成对应分镜" : "请先生成并确认一版剧本";
    }
    if (continueButton) {
      continueButton.disabled = isBusy || !hasScript;
      continueButton.title = hasScript ? "承接当前剧本的结尾钩子续写下一集" : "请先生成一版剧本";
    }
    if (beatSheetButton) {
      beatSheetButton.disabled = isBusy || !hasCompletePlan;
      beatSheetButton.title = hasCompletePlan ? "根据本集策划和已选角色/梗生成 8 个因果节拍" : "请先完成本集策划";
    }
    ["checkContinuityBtn", "regenerateTopicsBtn", "suggestPlansBtn", "autoPlanBtn", "approveBeatSheetBtn", "suggestCreativeMixBtn", "generateBibleBtn", "generateCharacterBtn", "applyBibleTemplateBtn", "memeLabBtn", "memeInspireBtn", "projectSelect", "newProjectBtn", "importProjectBtn", "applyRecastBtn"].forEach((id) => {
      const control = document.getElementById(id);
      if (control) control.disabled = isBusy;
    });
    $$('[data-topic-generate], [data-topic-continue], [data-topic-replace], [data-plan-option], [data-plan-batch-restore], [data-ai-model-value]').forEach((button) => {
      button.disabled = isBusy;
    });
    document.body?.setAttribute("aria-busy", String(isBusy));
    if (stage) {
      stage.classList.toggle("has-script", hasScript);
      stage.classList.toggle("has-storyboard", hasStoryboard);
    }
    const recastButton = $("#openRecastBtn");
    if (recastButton) recastButton.disabled = isBusy || !hasScript || !(currentProject()?.characterCards || []).length;
    refreshToolbarState();
  }

  function beginAiOperation(label) {
    return aiOperations.begin(label);
  }

  function assertActiveAiOperation(operation) {
    aiOperations.assertActive(operation);
  }

  function endAiOperation(operation) {
    aiOperations.end(operation);
  }

  function resetCurrentCreation() {
    state.currentEpisodeId = null;
    state.reviewEpisodeId = null;
    state.currentHistoryId = null;
    state.script = null;
    state.storyboard = [];
    state.creativePack = null;
    state.scriptDoctor = null;
    state.selectedTopic = null;
    state.planOptions = [];
    state.selectedPlanOptionId = null;
    state.activePlanBatchId = null;
    state.memeIdeas = [];
    state.activeMemeIds = [];
    state.activeCharacterIds = [];
    state.creativeMixOptions = [];
    state.selectedCreativeMixId = null;
    state.activeCreativeMixBatchId = null;
    state.beatSheet = [];
    state.beatSheetApproved = false;
    state.activeBeatSheetBatchId = null;
    state.continuationSource = null;
    setInputValue("episodeNumber", nextEpisodeNumber());
    renderPlanSuggestions();
    renderMemeLab();
    renderCreativeAssetPicker();
    renderCreativeMixResults();
    renderBeatSheet();
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
      characters: "角色库",
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
      clipMode: $("#clipMode")?.value || "smart",
      episodeCount: Number($("#episodeCount").value),
      episodeNumber: Number($("#episodeNumber")?.value || 1),
      style: $("#customStyle")?.value.trim() || $("#style").value,
      memeSeed: $("#memeSeed") ? $("#memeSeed").value.trim() : "",
      activeMemeIds: [...state.activeMemeIds],
      activeCharacterIds: [...state.activeCharacterIds],
      creativeMixBrief: $("#creativeMixBrief")?.value.trim() || "",
      creativeMixRef: {
        batchId: state.activeCreativeMixBatchId || "",
        mixId: state.selectedCreativeMixId || "",
      },
      aiModel: state.aiModels.script,
      aiModels: { ...state.aiModels },
      continueInstruction: $("#continueInstruction") ? $("#continueInstruction").value.trim() : "",
      episodePlan: {
        openingHook: $("#planOpeningHook")?.value.trim() || "",
        conflict: $("#planConflict")?.value.trim() || "",
        protagonistGoal: $("#planProtagonistGoal")?.value.trim() || "",
        stakes: $("#planStakes")?.value.trim() || "",
        forcedChoice: $("#planForcedChoice")?.value.trim() || "",
        reversal: $("#planReversal")?.value.trim() || "",
        relationshipShift: $("#planRelationshipShift")?.value.trim() || "",
        endingSuspense: $("#planEndingSuspense")?.value.trim() || "",
        targetEmotion: $("#planTargetEmotion")?.value.trim() || "",
      },
      episodePlanRef: {
        batchId: state.activePlanBatchId || "",
        planId: state.selectedPlanOptionId || "",
      },
      beatSheet: state.beatSheet.map((beat) => ({ ...beat, assetIds: [...(beat.assetIds || [])] })),
      beatSheetRef: {
        batchId: state.activeBeatSheetBatchId || "",
        approved: state.beatSheetApproved,
      },
    };
  }

  function restoreActiveSelections(input = {}) {
    const project = currentProject();
    const memeIds = new Set((project?.memes || []).map((item) => item.id));
    const characterIds = new Set((project?.characterCards || []).map((item) => item.id));
    state.activeMemeIds = (Array.isArray(input.activeMemeIds) ? input.activeMemeIds : []).filter((id) => memeIds.has(id));
    state.activeCharacterIds = (Array.isArray(input.activeCharacterIds) ? input.activeCharacterIds : []).filter((id) => characterIds.has(id));
    renderMemeLibrary();
    renderCharacterCards();
    renderCreativeAssetPicker();
  }

  function restoreCreativeWorkflow(input = {}) {
    const project = currentProject();
    state.activeCreativeMixBatchId = input.creativeMixRef?.batchId || null;
    state.selectedCreativeMixId = input.creativeMixRef?.mixId || null;
    const mixBatch = (project?.creativeMixBatches || []).find((batch) => batch.id === state.activeCreativeMixBatchId);
    state.creativeMixOptions = (mixBatch?.mixes || []).map((item) => ({ ...item, characterIds: [...(item.characterIds || [])], memeIds: [...(item.memeIds || [])], planPatch: { ...(item.planPatch || {}) } }));
    state.activeBeatSheetBatchId = input.beatSheetRef?.batchId || null;
    state.beatSheet = normalizeBeatSheet({ beats: input.beatSheet || [] });
    state.beatSheetApproved = Boolean(input.beatSheetRef?.approved && state.beatSheet.length === 8);
    renderCreativeMixResults();
    renderCreativeMixHistory();
    renderBeatSheet();
  }

  function characterRoleLine(card) {
    const catchphrase = card.catchphrases?.[0] ? `；口头禅“${card.catchphrases[0]}”` : "";
    return `${card.name}：${card.role}；${card.traits}；反差：${card.contrast}${catchphrase}；说话节奏：${card.speechPattern || "未设定"}；压力反应：${card.pressureResponse || "未设定"}；撒谎破绽：${card.lieTell || "未设定"}；动作习惯：${card.mannerism}；底线：${card.boundary}`;
  }

  function memeSeedLine(meme) {
    return `梗机制：${meme.phrase}｜${meme.mechanism}｜笑点：${meme.comedy}`;
  }

  function markBeatSheetStale() {
    if (!state.beatSheet.length) return;
    state.beatSheetApproved = false;
    renderBeatSheet();
    refreshCreationActions();
  }

  function syncActiveAssetsToInputs() {
    const project = currentProject();
    const knownRoleLines = new Set((project?.characterCards || []).map(characterRoleLine));
    const manualRoleLines = $("#roles").value.split("\n").filter((line) => line.trim() && !knownRoleLines.has(line.trim()));
    const selectedRoleLines = (project?.characterCards || []).filter((card) => state.activeCharacterIds.includes(card.id)).map(characterRoleLine);
    setInputValue("roles", [...manualRoleLines, ...selectedRoleLines].join("\n"));

    const knownMemeLines = new Set((project?.memes || []).map(memeSeedLine));
    const manualMemeLines = $("#memeSeed").value.split("\n").filter((line) => line.trim() && !knownMemeLines.has(line.trim()));
    const selectedMemeLines = (project?.memes || []).filter((meme) => state.activeMemeIds.includes(meme.id)).map(memeSeedLine);
    setInputValue("memeSeed", [...manualMemeLines, ...selectedMemeLines].join("\n"));
  }

  function renderCreativeAssetPicker() {
    const project = currentProject();
    const characterTarget = $("#characterPicker");
    const memeTarget = $("#memePicker");
    if (!characterTarget || !memeTarget) return;
    const cards = project?.characterCards || [];
    const memes = project?.memes || [];
    $("#activeCharacterCount").textContent = `${state.activeCharacterIds.length}/${cards.length}`;
    $("#activeMemeCount").textContent = `${state.activeMemeIds.length}/${memes.length}`;
    characterTarget.innerHTML = cards.length
      ? cards.map((card) => `<button type="button" class="asset-picker-button ${state.activeCharacterIds.includes(card.id) ? "is-active" : ""}" data-creative-character="${escapeHtml(card.id)}" title="${escapeHtml(card.role || card.traits)}">${escapeHtml(card.name)}</button>`).join("")
      : `<p class="asset-picker-empty">角色库为空，请先到“设定库 → 角色库”创建角色卡。</p>`;
    memeTarget.innerHTML = memes.length
      ? memes.map((meme) => `<button type="button" class="asset-picker-button ${state.activeMemeIds.includes(meme.id) ? "is-active" : ""}" data-creative-meme="${escapeHtml(meme.id)}" title="${escapeHtml(meme.mechanism)}">${escapeHtml(meme.phrase)}</button>`).join("")
      : `<p class="asset-picker-empty">梗库为空，请先收藏或录入可复用梗。</p>`;
  }

  function setCreativeAssetSelection(characterIds, memeIds, countUsage = false) {
    const project = currentProject();
    const validCharacterIds = new Set((project?.characterCards || []).map((item) => item.id));
    const validMemeIds = new Set((project?.memes || []).map((item) => item.id));
    state.activeCharacterIds = [...new Set(characterIds || [])].filter((id) => validCharacterIds.has(id)).slice(0, 4);
    state.activeMemeIds = [...new Set(memeIds || [])].filter((id) => validMemeIds.has(id)).slice(0, 2);
    if (countUsage) {
      (project?.memes || []).forEach((meme) => {
        if (!state.activeMemeIds.includes(meme.id)) return;
        meme.useCount = Number(meme.useCount || 0) + 1;
        meme.lastUsedAt = new Date().toISOString();
      });
    }
    syncActiveAssetsToInputs();
    renderCreativeAssetPicker();
    renderMemeLibrary();
    renderCharacterCards();
    markBeatSheetStale();
  }

  function toggleCreativeCharacter(id) {
    const ids = state.activeCharacterIds.includes(id)
      ? state.activeCharacterIds.filter((item) => item !== id)
      : [...state.activeCharacterIds, id];
    setCreativeAssetSelection(ids, state.activeMemeIds);
    state.selectedCreativeMixId = null;
    setStatus("已更新本集重点角色卡；未入库角色仍可参与剧情");
    saveDraft(false);
  }

  function toggleCreativeMeme(id) {
    const ids = state.activeMemeIds.includes(id)
      ? state.activeMemeIds.filter((item) => item !== id)
      : [...state.activeMemeIds, id];
    setCreativeAssetSelection(state.activeCharacterIds, ids);
    state.selectedCreativeMixId = null;
    setStatus("已更新本集梗，生成时会要求它成为动作、规则或回扣，而不是一句硬塞台词");
    saveDraft(false);
  }

  function normalizeCreativeMixOptions(result = {}) {
    const project = currentProject();
    const characterIds = new Set((project?.characterCards || []).map((item) => item.id));
    const memeIds = new Set((project?.memes || []).map((item) => item.id));
    return (Array.isArray(result?.mixes) ? result.mixes : []).slice(0, 3).map((item, index) => ({
      id: String(item.id || `creative-mix-${Date.now()}-${index}`),
      angle: String(item.angle || `搭配 ${index + 1}`).trim(),
      title: String(item.title || "未命名搭配").trim(),
      characterIds: [...new Set(Array.isArray(item.characterIds) ? item.characterIds.map(String) : [])].filter((id) => characterIds.has(id)).slice(0, 4),
      memeIds: [...new Set(Array.isArray(item.memeIds) ? item.memeIds.map(String) : [])].filter((id) => memeIds.has(id)).slice(0, 2),
      relationshipCollision: String(item.relationshipCollision || "").trim(),
      memeMechanism: String(item.memeMechanism || "").trim(),
      plotEngine: String(item.plotEngine || "").trim(),
      openingImage: String(item.openingImage || "").trim(),
      planPatch: item.planPatch && typeof item.planPatch === "object" ? { ...item.planPatch } : {},
    })).filter((item) => item.characterIds.length >= 2 && item.memeIds.length && item.relationshipCollision && item.memeMechanism && item.plotEngine);
  }

  function renderCreativeMixResults() {
    const target = $("#creativeMixResults");
    if (!target) return;
    target.hidden = !state.creativeMixOptions.length;
    const project = currentProject();
    const characterMap = new Map((project?.characterCards || []).map((item) => [item.id, item.name]));
    const memeMap = new Map((project?.memes || []).map((item) => [item.id, item.phrase]));
    target.innerHTML = state.creativeMixOptions.map((option, index) => `
      <article class="creative-mix-option ${option.id === state.selectedCreativeMixId ? "is-selected" : ""}">
        <header><h3>${escapeHtml(option.angle)} · ${escapeHtml(option.title)}</h3><button class="small-action" type="button" data-creative-mix-option="${index}">${option.id === state.selectedCreativeMixId ? "已采用" : "采用"}</button></header>
        <div class="tagline">${option.characterIds.map((id) => `<span class="tag">${escapeHtml(characterMap.get(id) || id)}</span>`).join("")}${option.memeIds.map((id) => `<span class="tag">梗：${escapeHtml(memeMap.get(id) || id)}</span>`).join("")}</div>
        <p><strong>关系碰撞：</strong>${escapeHtml(option.relationshipCollision)}</p>
        <p><strong>梗的剧情用法：</strong>${escapeHtml(option.memeMechanism)}</p>
        <p><strong>剧情发动机：</strong>${escapeHtml(option.plotEngine)}</p>
        <p><strong>开场画面：</strong>${escapeHtml(option.openingImage)}</p>
      </article>`).join("");
  }

  function renderCreativeMixHistory() {
    const batches = currentProject()?.creativeMixBatches || [];
    const target = $("#creativeMixHistoryList");
    const count = $("#creativeMixHistoryCount");
    if (count) count.textContent = String(batches.length);
    if (!target) return;
    target.innerHTML = batches.length ? batches.slice(0, 8).map((batch) => {
      const selected = (batch.mixes || []).find((mix) => mix.id === batch.selectedMixId);
      return `<div class="plan-history-item"><div><strong>第 ${escapeHtml(batch.episodeNumber || 1)} 集 · ${escapeHtml(batch.theme || "未命名选题")}</strong><span>${escapeHtml(new Date(batch.createdAt).toLocaleString("zh-CN", { hour12: false }))} · ${escapeHtml(selected ? `已采用 ${selected.angle}` : "3 套待筛选")}</span></div><button class="small-action" type="button" data-creative-mix-restore="${escapeHtml(batch.id)}">恢复三案</button></div>`;
    }).join("") : `<p class="helper">每次 AI 生成的三套角色与梗搭配都会保存在当前项目。</p>`;
  }

  async function suggestCreativeMixes() {
    const project = currentProject();
    if ((project?.characterCards || []).length < 2) throw new Error("角色库至少需要 2 张角色卡，才能设计关系碰撞。");
    if (!(project?.memes || []).length) throw new Error("梗库还是空的，请先收藏或录入至少一个梗。");
    const operation = beginAiOperation("角色与梗搭配");
    try {
      setStatus("DeepSeek 正在从现有角色卡和梗库中设计 3 套剧情组合...");
      const input = getInput();
      const response = await apiRequest("/api/creative-mix", { input: {
        ...generationContext(input, "mix"),
        candidateCharacterCards: (project.characterCards || []).slice(0, 20),
        candidateMemes: (project.memes || []).slice(0, 30),
      } });
      assertActiveAiOperation(operation);
      const options = normalizeCreativeMixOptions(response.result);
      if (options.length !== 3) throw new Error("AI 没有返回 3 套可用搭配，请重新生成。");
      state.creativeMixOptions = options;
      state.selectedCreativeMixId = null;
      const batch = {
        id: newId("creative-mix-batch"), createdAt: new Date().toISOString(), episodeNumber: input.episodeNumber,
        theme: input.theme, model: response.model || "", source: response.source || "", mixes: options.map((item) => ({ ...item, characterIds: [...item.characterIds], memeIds: [...item.memeIds], planPatch: { ...item.planPatch } })), selectedMixId: null,
      };
      project.creativeMixBatches = [batch, ...(project.creativeMixBatches || [])].slice(0, 30);
      state.activeCreativeMixBatchId = batch.id;
      await persistProjects();
      renderCreativeMixResults();
      renderCreativeMixHistory();
      saveDraft(false);
      setStatus(`已生成 3 套角色与梗搭配${usageSuffix(response)}`);
    } finally {
      endAiOperation(operation);
    }
  }

  function adoptCreativeMix(index) {
    const option = state.creativeMixOptions[index];
    if (!option) throw new Error("没有找到这套搭配。");
    setCreativeAssetSelection(option.characterIds, option.memeIds, true);
    state.selectedCreativeMixId = option.id;
    setInputValue("creativeMixBrief", [
      `关系碰撞：${option.relationshipCollision}`,
      `梗的剧情机制：${option.memeMechanism}`,
      `剧情发动机：${option.plotEngine}`,
      `开场强画面：${option.openingImage}`,
    ].join("\n"));
    const currentPlan = getInput().episodePlan;
    const mergedPlan = { ...currentPlan };
    ["protagonistGoal", "stakes", "forcedChoice", "relationshipShift"].forEach((key) => {
      if (!mergedPlan[key] && option.planPatch[key]) mergedPlan[key] = option.planPatch[key];
    });
    applyEpisodePlan(mergedPlan);
    const batch = (currentProject()?.creativeMixBatches || []).find((item) => item.id === state.activeCreativeMixBatchId);
    if (batch) batch.selectedMixId = option.id;
    persistProjects();
    renderCreativeMixResults();
    renderCreativeMixHistory();
    saveDraft(false);
    setStatus(`已采用“${option.angle}”，角色、梗和组合要求已写入本集`);
  }

  function restoreCreativeMixBatch(id) {
    const batch = (currentProject()?.creativeMixBatches || []).find((item) => item.id === id);
    if (!batch) throw new Error("没有找到这批搭配记录。");
    state.creativeMixOptions = (batch.mixes || []).map((item) => ({ ...item, characterIds: [...(item.characterIds || [])], memeIds: [...(item.memeIds || [])], planPatch: { ...(item.planPatch || {}) } }));
    state.activeCreativeMixBatchId = batch.id;
    state.selectedCreativeMixId = batch.selectedMixId || null;
    renderCreativeMixResults();
    setStatus("已恢复这批角色与梗搭配，可以重新筛选");
  }

  function renderAiModelSwitches() {
    $$('[data-ai-model-switch]').forEach((target) => {
      const scope = target.dataset.aiModelScope || "script";
      const model = state.aiModels[scope] || "deepseek-v4-flash";
      target.classList.add("ai-model-switch");
      target.innerHTML = [
        ["deepseek-v4-flash", "Flash"],
        ["deepseek-v4-pro", "Pro"],
      ].map(([value, label]) => `<button type="button" data-ai-model-value="${value}" data-ai-model-scope="${scope}" class="${value === model ? "is-active" : ""}" aria-pressed="${value === model}">${label}</button>`).join("");
    });
  }

  function setAiModel(scope, model) {
    if (!aiModelScopes.includes(scope)) return;
    if (!["deepseek-v4-flash", "deepseek-v4-pro"].includes(model)) return;
    state.aiModels[scope] = model;
    if (scope === "script" && $("#aiModel")) $("#aiModel").value = model;
    renderAiModelSwitches();
    saveDraft(false);
    setStatus(`${aiModelScopeLabels[scope]}模型已切换为 ${model.endsWith("pro") ? "Pro（质量优先）" : "Flash（速度优先）"}，不会影响其他模块`);
  }

  function restoreAiModels(input = {}) {
    const legacyModel = ["deepseek-v4-flash", "deepseek-v4-pro"].includes(input.aiModel) ? input.aiModel : "deepseek-v4-flash";
    const saved = input.aiModels && typeof input.aiModels === "object" ? input.aiModels : {};
    state.aiModels = Object.fromEntries(aiModelScopes.map((scope) => {
      const model = saved[scope] || legacyModel;
      return [scope, ["deepseek-v4-flash", "deepseek-v4-pro"].includes(model) ? model : "deepseek-v4-flash"];
    }));
    if ($("#aiModel")) $("#aiModel").value = state.aiModels.script;
    renderAiModelSwitches();
  }

  function applyEpisodePlan(plan = {}) {
    markBeatSheetStale();
    setInputValue("planOpeningHook", plan.openingHook || "");
    setInputValue("planConflict", plan.conflict || "");
    setInputValue("planProtagonistGoal", plan.protagonistGoal || "");
    setInputValue("planStakes", plan.stakes || "");
    setInputValue("planForcedChoice", plan.forcedChoice || "");
    setInputValue("planReversal", plan.reversal || "");
    setInputValue("planRelationshipShift", plan.relationshipShift || "");
    setInputValue("planEndingSuspense", plan.endingSuspense || "");
    setInputValue("planTargetEmotion", plan.targetEmotion || "");
    renderBeatSheet();
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
      protagonistGoal: "目标",
      stakes: "代价",
      forcedChoice: "选择",
      reversal: "反转",
      relationshipShift: "关系",
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
        ${(option.innovation || option.memeMechanic || option.visualSetpiece) ? `<div class="plan-option-insights">
          ${option.innovation ? `<span><strong>创新：</strong>${escapeHtml(option.innovation)}</span>` : ""}
          ${option.memeMechanic ? `<span><strong>梗机制：</strong>${escapeHtml(option.memeMechanic)}</span>` : ""}
          ${option.visualSetpiece ? `<span><strong>强画面：</strong>${escapeHtml(option.visualSetpiece)}</span>` : ""}
        </div>` : ""}
        <ul class="plan-option-preview">
          ${Object.entries(labels).map(([key, label]) => `<li><strong>${label}：</strong>${escapeHtml(option.plan[key])}</li>`).join("")}
        </ul>
      </article>
    `).join("");
  }

  function renderPlanHistory() {
    const project = currentProject();
    const batches = Array.isArray(project?.planBatches) ? project.planBatches : [];
    const count = $("#planHistoryCount");
    const target = $("#planHistoryList");
    if (count) count.textContent = String(batches.length);
    if (!target) return;
    target.innerHTML = batches.length
      ? batches.slice(0, 8).map((batch) => {
        const selected = (batch.plans || []).find((plan) => plan.id === batch.selectedPlanId);
        const time = new Date(batch.createdAt).toLocaleString("zh-CN", { hour12: false });
        return `<div class="plan-history-item">
          <div>
            <strong>第 ${escapeHtml(batch.episodeNumber || 1)} 集 · ${escapeHtml(batch.theme || "未命名选题")}</strong>
            <span>${escapeHtml(time)} · ${escapeHtml(batch.model || "DeepSeek")} · ${escapeHtml(selected ? `已采用 ${selected.angle}` : "3 套待筛选")}</span>
          </div>
          <button class="small-action" type="button" data-plan-batch-restore="${escapeHtml(batch.id)}">恢复三案</button>
        </div>`;
      }).join("")
      : `<p class="helper">每次让 DeepSeek 生成的 3 套策划都会保存在当前项目中。</p>`;
  }

  async function archivePlanBatch(options, response, input) {
    const project = currentProject();
    if (!project) return null;
    const inputKeys = ["theme", "roles", "scene", "direction", "audience", "duration", "clipMode", "episodeCount", "episodeNumber", "style", "memeSeed", "aiModel", "continueInstruction"];
    const batchInput = Object.fromEntries(inputKeys.map((key) => [key, input[key]]));
    const batch = {
      id: newId("plan-batch"),
      createdAt: new Date().toISOString(),
      episodeNumber: Number(input.episodeNumber || 1),
      theme: input.theme || "未命名选题",
      model: response.model || "",
      source: response.source || "",
      input: batchInput,
      plans: options.map((option) => ({ ...option, plan: { ...option.plan } })),
      selectedPlanId: null,
    };
    project.planBatches = [batch, ...(project.planBatches || [])].slice(0, 30);
    project.updatedAt = batch.createdAt;
    state.activePlanBatchId = batch.id;
    await persistProjects();
    renderPlanHistory();
    return batch;
  }

  function restorePlanBatch(id) {
    const batch = (currentProject()?.planBatches || []).find((item) => item.id === id);
    if (!batch) throw new Error("没有找到这批策划记录。");
    Object.entries(batch.input || {}).forEach(([key, value]) => {
      if (!["episodePlan", "episodePlanRef"].includes(key)) setInputValue(key, value);
    });
    state.planOptions = (batch.plans || []).map((option) => ({ ...option, plan: { ...option.plan } }));
    state.activePlanBatchId = batch.id;
    state.selectedPlanOptionId = batch.selectedPlanId || null;
    applyEpisodePlan(state.planOptions.find((option) => option.id === batch.selectedPlanId)?.plan || {});
    renderPlanSuggestions();
    saveDraft(false);
    setStatus(`已恢复第 ${batch.episodeNumber || 1} 集的 3 套策划，可以重新筛选`);
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
      const response = await apiRequest("/api/plans", { input: generationContext(input, "plan") });
      assertActiveAiOperation(operation);
      const options = episodePlanner.normalizePlanOptions(response.result, { prefix: "ai-plan" });
      if (options.length !== 3) throw new Error("DeepSeek 没有返回 3 套完整策划，请重新生成。");
      state.planOptions = options;
      state.selectedPlanOptionId = null;
      await archivePlanBatch(options, response, input);
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
    state.planOptions = [];
    state.selectedPlanOptionId = null;
    state.activePlanBatchId = null;
    renderPlanSuggestions();
    saveDraft(false);
    setStatus("本集策划已自动填好，下一步生成并确认剧情节拍表");
    return plan;
  }

  function adoptPlanOption(index) {
    const option = state.planOptions[index];
    if (!option) throw new Error("没有找到这套策划，请重新生成灵感。");
    applyEpisodePlan(option.plan);
    state.selectedPlanOptionId = option.id;
    const batch = (currentProject()?.planBatches || []).find((item) => item.id === state.activePlanBatchId);
    if (batch) {
      batch.selectedPlanId = option.id;
      batch.updatedAt = new Date().toISOString();
      persistProjects();
      renderPlanHistory();
    }
    renderPlanSuggestions();
    saveDraft(false);
    setStatus(`已采用“${option.angle}”方案，可以继续微调`);
  }

  function normalizeBeatSheet(result = {}) {
    const source = Array.isArray(result?.beats) ? result.beats : [];
    return source.slice(0, 8).map((beat, index) => ({
      id: String(beat.id || `BEAT-${String(index + 1).padStart(2, "0")}`),
      timeRange: String(beat.timeRange || "").trim(),
      dramaticTask: String(beat.dramaticTask || "").trim(),
      characterGoal: String(beat.characterGoal || "").trim(),
      action: String(beat.action || "").trim(),
      newInformation: String(beat.newInformation || "").trim(),
      emotion: String(beat.emotion || "").trim(),
      causalLink: String(beat.causalLink || "").trim(),
      assetIds: [...new Set(Array.isArray(beat.assetIds) ? beat.assetIds.map(String) : [])].slice(0, 4),
    })).filter((beat) => beat.timeRange && beat.dramaticTask && beat.characterGoal && beat.action && beat.causalLink);
  }

  function renderBeatSheet() {
    const target = $("#beatSheetList");
    const status = $("#beatSheetStatus");
    const approveButton = $("#approveBeatSheetBtn");
    if (!target || !status || !approveButton) return;
    target.innerHTML = state.beatSheet.map((beat, index) => `
      <article class="beat-card">
        <span class="beat-index">${index + 1}</span>
        <div>
          <strong>${escapeHtml(beat.timeRange)} · ${escapeHtml(beat.dramaticTask)}</strong>
          <p><b>人物行动：</b>${escapeHtml(beat.characterGoal)} → ${escapeHtml(beat.action)}</p>
          ${beat.newInformation ? `<p><b>新增信息：</b>${escapeHtml(beat.newInformation)}</p>` : ""}
          <p><b>因果：</b>${escapeHtml(beat.causalLink)}</p>
        </div>
      </article>`).join("");
    approveButton.hidden = state.beatSheet.length !== 8;
    approveButton.textContent = state.beatSheetApproved ? "已确认这版节拍表" : "确认这版节拍表";
    status.textContent = state.beatSheetApproved
      ? "已确认，正式剧本会严格按这 8 个因果节点展开"
      : state.beatSheet.length
        ? "这版节拍表已留档；确认后才可生成正式剧本"
        : episodePlanner.planIsComplete(getInput().episodePlan)
          ? "策划已完成，可以让 AI 拆成 8 个剧情节拍"
          : "策划完成后可生成";
    status.classList.toggle("is-approved", state.beatSheetApproved);
    renderBeatSheetHistory();
  }

  function renderBeatSheetHistory() {
    const batches = currentProject()?.beatSheetBatches || [];
    const target = $("#beatSheetHistoryList");
    const count = $("#beatSheetHistoryCount");
    if (count) count.textContent = String(batches.length);
    if (!target) return;
    target.innerHTML = batches.length ? batches.slice(0, 8).map((batch, index) => `
      <div class="plan-history-item">
        <div><strong>第 ${escapeHtml(batch.episodeNumber || 1)} 集 · 节拍表 v${batches.length - index}</strong><span>${escapeHtml(new Date(batch.createdAt).toLocaleString("zh-CN", { hour12: false }))} · ${batch.approved ? "已确认" : "未确认"}</span></div>
        <button class="small-action" type="button" data-beat-sheet-restore="${escapeHtml(batch.id)}">恢复</button>
      </div>`).join("") : `<p class="helper">生成过的节拍表会保存在当前项目，方便比较和恢复。</p>`;
  }

  async function generateBeatSheet() {
    const input = getInput();
    validateEpisodePlan(input);
    const operation = beginAiOperation("剧情节拍表生成");
    try {
      setStatus("DeepSeek 正在把策划拆成 8 个因果节拍...");
      const response = await apiRequest("/api/beat-sheet", { input: generationContext(input, "beat") });
      assertActiveAiOperation(operation);
      const beats = normalizeBeatSheet(response.result);
      if (beats.length !== 8) throw new Error("AI 没有返回 8 个完整剧情节拍，请重新生成。");
      state.beatSheet = beats;
      state.beatSheetApproved = false;
      const project = currentProject();
      const batch = {
        id: newId("beat-sheet-batch"), createdAt: new Date().toISOString(), episodeNumber: input.episodeNumber,
        theme: input.theme, model: response.model || "", source: response.source || "", approved: false,
        beats: beats.map((beat) => ({ ...beat, assetIds: [...beat.assetIds] })),
      };
      project.beatSheetBatches = [batch, ...(project.beatSheetBatches || [])].slice(0, 30);
      state.activeBeatSheetBatchId = batch.id;
      await persistProjects();
      renderBeatSheet();
      saveDraft(false);
      setStatus(`剧情节拍表已生成并留档，请确认因果后再写剧本${usageSuffix(response)}`);
    } finally {
      endAiOperation(operation);
    }
  }

  function approveBeatSheet() {
    if (state.beatSheet.length !== 8) throw new Error("请先生成一版完整的 8 节拍表。");
    state.beatSheetApproved = true;
    const batch = (currentProject()?.beatSheetBatches || []).find((item) => item.id === state.activeBeatSheetBatchId);
    if (batch) batch.approved = true;
    persistProjects();
    renderBeatSheet();
    refreshCreationActions();
    saveDraft(false);
    setStatus("节拍表已确认，现在可以生成正式剧本");
  }

  function restoreBeatSheetBatch(id) {
    const batch = (currentProject()?.beatSheetBatches || []).find((item) => item.id === id);
    if (!batch) throw new Error("没有找到这版节拍表。");
    state.beatSheet = normalizeBeatSheet({ beats: batch.beats });
    state.beatSheetApproved = Boolean(batch.approved);
    state.activeBeatSheetBatchId = batch.id;
    renderBeatSheet();
    refreshCreationActions();
    saveDraft(false);
    setStatus(`已恢复第 ${batch.episodeNumber || 1} 集的节拍表`);
  }

  function normalizeMemeIdeas(result) {
    const source = Array.isArray(result?.ideas) ? result.ideas : [];
    return source.slice(0, 6).map((idea, index) => ({
      id: idea.id || `meme-idea-${Date.now()}-${index}`,
      phrase: String(idea.phrase || `梗结构 ${index + 1}`).trim(),
      meaning: String(idea.meaning || "").trim(),
      mechanism: String(idea.mechanism || "").trim(),
      comedy: String(idea.comedy || "").trim(),
      fit: String(idea.fit || "").trim(),
      risk: String(idea.risk || "").trim(),
      sourceType: String(idea.sourceType || "原创结构").trim(),
    })).filter((idea) => idea.mechanism && idea.comedy);
  }

  function renderMemeLab() {
    const target = $("#memeLabResults");
    if (!target) return;
    target.innerHTML = state.memeIdeas.map((idea, index) => `
      <article class="meme-idea">
        <div>
          <strong>${escapeHtml(idea.phrase)} · ${escapeHtml(idea.sourceType)}</strong>
          ${idea.meaning ? `<p>${escapeHtml(idea.meaning)}</p>` : ""}
          <p><b>剧情机制：</b>${escapeHtml(idea.mechanism)}</p>
          <p><b>笑点：</b>${escapeHtml(idea.comedy)}</p>
          <small>${escapeHtml(idea.fit)}${idea.risk ? ` · 注意：${escapeHtml(idea.risk)}` : ""}</small>
        </div>
        <div class="meme-idea-actions">
          <button class="small-action" type="button" data-meme-idea-add="${index}">加入本集</button>
          <button class="small-action ${memeIdeaIsSaved(idea) ? "is-saved" : ""}" type="button" data-meme-idea-save="${index}" ${memeIdeaIsSaved(idea) ? "disabled" : ""}>${memeIdeaIsSaved(idea) ? "已收藏" : "收藏到梗库"}</button>
        </div>
      </article>
    `).join("");
  }

  async function runMemeLab(mode) {
    const rawMaterial = $("#memeSeed").value.trim();
    if (mode === "extract" && !rawMaterial) throw new Error("请先粘贴热榜标题、分享文案或评论高频词；没有素材时可点击“生成梗结构”。");
    const operation = beginAiOperation(mode === "extract" ? "热梗素材提炼" : "梗结构生成");
    try {
      setStatus(mode === "extract" ? "AI 正在把真实素材转成可拍剧情机制..." : "AI 正在生成不冒充实时热点的平台化梗结构...");
      const initialResponse = await apiRequest("/api/meme-lab", {
        input: generationContext({ ...getInput(), memeLabMode: mode, memeRawMaterial: rawMaterial }, "meme"),
      });
      const response = await resolveAiJob(initialResponse, "热梗素材");
      assertActiveAiOperation(operation);
      state.memeIdeas = normalizeMemeIdeas(response.result);
      if (!state.memeIdeas.length) throw new Error("AI 没有返回可用的剧情梗，请重新生成。");
      renderMemeLab();
      saveDraft(false);
      setStatus(`已得到 ${state.memeIdeas.length} 个可拍梗机制 ${nowTime()} · ${response.model || "model"}${usageSuffix(response)}`);
    } finally {
      endAiOperation(operation);
    }
  }

  function adoptMemeIdea(index) {
    const idea = state.memeIdeas[index];
    if (!idea) throw new Error("没有找到这个梗结构。");
    const addition = `梗机制：${idea.phrase}｜${idea.mechanism}｜笑点：${idea.comedy}`;
    const current = $("#memeSeed").value.trim();
    if (!current.includes(addition)) setInputValue("memeSeed", [current, addition].filter(Boolean).join("\n"));
    saveDraft(false);
    setStatus(`已把“${idea.phrase}”加入本集创作素材`);
  }

  function memeIdeaIsSaved(idea) {
    const key = `${String(idea?.phrase || "").trim()}|${String(idea?.mechanism || "").trim()}`;
    return (currentProject()?.memes || []).some((item) => `${String(item.phrase || "").trim()}|${String(item.mechanism || "").trim()}` === key);
  }

  function saveMemeIdea(index) {
    const idea = state.memeIdeas[index];
    if (!idea) throw new Error("没有找到这个梗结构。");
    if (memeIdeaIsSaved(idea)) throw new Error("这个梗已经收藏过了。");
    currentProject().memes.push({ ...idea, id: newId("meme"), tags: [], useCount: 0, createdAt: new Date().toISOString() });
    persistProjects();
    renderMemeLab();
    renderMemeLibrary();
    renderCreativeAssetPicker();
    renderProject();
    setStatus(`已收藏“${idea.phrase}”，以后可在资产库的项目梗库中复用`);
  }

  function addManualMeme() {
    const phrase = $("#memeName").value.trim();
    const mechanism = $("#memeMechanism").value.trim();
    const comedy = $("#memeComedy").value.trim();
    if (!phrase || !mechanism || !comedy) throw new Error("请填写梗名称、剧情机制和铺垫回扣。");
    const idea = {
      id: newId("meme"), phrase, mechanism, comedy,
      meaning: "", fit: "", risk: "", sourceType: "手动录入", useCount: 0,
      tags: $("#memeTags").value.split(/[,，、\n]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
      createdAt: new Date().toISOString(),
    };
    if (memeIdeaIsSaved(idea)) throw new Error("这个梗已经收藏过了。");
    currentProject().memes.push(idea);
    ["memeName", "memeMechanism", "memeComedy", "memeTags"].forEach((id) => setInputValue(id, ""));
    persistProjects();
    renderMemeLibrary();
    renderCreativeAssetPicker();
    renderProject();
    setStatus(`已把“${phrase}”存入项目梗库`);
  }

  function renderMemeLibrary() {
    const target = $("#memeLibrary");
    if (!target) return;
    const memes = currentProject()?.memes || [];
    const query = String($("#memeLibrarySearch")?.value || "").trim().toLowerCase();
    const source = $("#memeLibrarySource")?.value || "all";
    const filtered = memes.filter((item) => {
      const haystack = [item.phrase, item.mechanism, item.comedy, ...(item.tags || [])].join(" ").toLowerCase();
      return (!query || haystack.includes(query)) && (source === "all" || item.sourceType === source);
    });
    $("#memeLibraryCount").textContent = `${memes.length} 条梗`;
    target.innerHTML = filtered.length ? filtered.slice().reverse().map((item) => `
      <article class="library-card meme-library-card">
        <div class="library-card-meta"><span>${escapeHtml(item.sourceType || "收藏")}</span><span>使用 ${escapeHtml(item.useCount || 0)} 次</span></div>
        <h4>${escapeHtml(item.phrase)}</h4>
        <p><strong>机制：</strong>${escapeHtml(item.mechanism)}</p>
        <p><strong>笑点：</strong>${escapeHtml(item.comedy)}</p>
        <div class="tagline">${(item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="library-card-actions"><button class="small-action ${state.activeMemeIds.includes(item.id) ? "is-active" : ""}" data-saved-meme-use="${escapeHtml(item.id)}">${state.activeMemeIds.includes(item.id) ? "移出本集" : "加入本集"}</button><button class="small-action danger-action" data-saved-meme-delete="${escapeHtml(item.id)}">移除</button></div>
      </article>`).join("") : `<p class="helper">${memes.length ? "没有符合当前筛选的梗。" : "梗库还是空的。可从左侧 AI 结果收藏，或在这里手动录入。"}</p>`;
  }

  function adoptSavedMeme(id) {
    const meme = (currentProject()?.memes || []).find((item) => item.id === id);
    if (!meme) throw new Error("没有找到这条梗。");
    const addition = memeSeedLine(meme);
    const current = $("#memeSeed").value.trim();
    if (state.activeMemeIds.includes(id)) {
      state.activeMemeIds = state.activeMemeIds.filter((item) => item !== id);
      setInputValue("memeSeed", current.split("\n").filter((line) => line.trim() !== addition).join("\n"));
      renderMemeLibrary();
      renderCreativeAssetPicker();
      markBeatSheetStale();
      saveDraft(false);
      setStatus(`已把“${meme.phrase}”移出本集素材`);
      return;
    }
    if (!current.includes(addition)) setInputValue("memeSeed", [current, addition].filter(Boolean).join("\n"));
    state.activeMemeIds.push(id);
    meme.useCount = Number(meme.useCount || 0) + 1;
    meme.lastUsedAt = new Date().toISOString();
    persistProjects();
    renderMemeLibrary();
    renderCreativeAssetPicker();
    markBeatSheetStale();
    saveDraft(false);
    setStatus(`已把“${meme.phrase}”加入本集素材`);
  }

  function deleteSavedMeme(id) {
    const project = currentProject();
    project.memes = (project.memes || []).filter((item) => item.id !== id);
    state.activeMemeIds = state.activeMemeIds.filter((item) => item !== id);
    syncActiveAssetsToInputs();
    markBeatSheetStale();
    persistProjects();
    renderMemeLibrary();
    renderCreativeAssetPicker();
    renderMemeLab();
    renderProject();
    setStatus("已从梗库移除");
  }

  function characterDraftFromForm() {
    const catchphrases = $("#characterCatchphrases").value.split(/\n|[；;]/).map((item) => item.trim()).filter(Boolean).slice(0, 5);
    return {
      name: $("#characterName").value.trim(), role: $("#characterRole").value.trim(), traits: $("#characterTraits").value.trim(),
      contrast: $("#characterContrast").value.trim(), desire: $("#characterDesire").value.trim(), weakness: $("#characterWeakness").value.trim(),
      catchphrases, mannerism: $("#characterMannerism").value.trim(), comedyTrigger: $("#characterComedyTrigger").value.trim(), boundary: $("#characterBoundary").value.trim(),
      speechPattern: $("#characterSpeechPattern").value.trim(), pressureResponse: $("#characterPressureResponse").value.trim(),
      lieTell: $("#characterLieTell").value.trim(), addressStyle: $("#characterAddressStyle").value.trim(),
      forbiddenPhrases: $("#characterForbiddenPhrases").value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 8),
      innerNeed: $("#characterInnerNeed").value.trim(), wound: $("#characterWound").value.trim(), secret: $("#characterSecret").value.trim(),
    };
  }

  function normalizeCharacterCard(card = {}) {
    return {
      id: card.id || newId("character"), name: String(card.name || "").trim(), role: String(card.role || "").trim(),
      traits: String(card.traits || "").trim(), contrast: String(card.contrast || "").trim(), desire: String(card.desire || "").trim(),
      weakness: String(card.weakness || "").trim(), catchphrases: (Array.isArray(card.catchphrases) ? card.catchphrases : String(card.catchphrases || "").split(/\n|[；;]/)).map((item) => String(item).trim()).filter(Boolean).slice(0, 5),
      mannerism: String(card.mannerism || "").trim(), comedyTrigger: String(card.comedyTrigger || "").trim(), boundary: String(card.boundary || "").trim(),
      speechPattern: String(card.speechPattern || "").trim(), pressureResponse: String(card.pressureResponse || "").trim(), lieTell: String(card.lieTell || "").trim(),
      addressStyle: String(card.addressStyle || "").trim(), forbiddenPhrases: (Array.isArray(card.forbiddenPhrases) ? card.forbiddenPhrases : String(card.forbiddenPhrases || "").split(/[,，、\n]/)).map((item) => String(item).trim()).filter(Boolean).slice(0, 8),
      innerNeed: String(card.innerNeed || "").trim(), wound: String(card.wound || "").trim(), secret: String(card.secret || "").trim(),
      createdAt: card.createdAt || new Date().toISOString(), updatedAt: card.updatedAt || new Date().toISOString(),
    };
  }

  function applyCharacterDraft(card = {}) {
    const normalized = normalizeCharacterCard(card);
    const fields = {
      characterName: normalized.name, characterRole: normalized.role, characterTraits: normalized.traits,
      characterContrast: normalized.contrast, characterDesire: normalized.desire, characterWeakness: normalized.weakness,
      characterCatchphrases: normalized.catchphrases.join("\n"), characterMannerism: normalized.mannerism,
      characterComedyTrigger: normalized.comedyTrigger, characterBoundary: normalized.boundary,
      characterSpeechPattern: normalized.speechPattern, characterPressureResponse: normalized.pressureResponse,
      characterLieTell: normalized.lieTell, characterAddressStyle: normalized.addressStyle,
      characterForbiddenPhrases: normalized.forbiddenPhrases.join("，"), characterInnerNeed: normalized.innerNeed,
      characterWound: normalized.wound, characterSecret: normalized.secret,
    };
    Object.entries(fields).forEach(([id, value]) => setInputValue(id, value));
  }

  function clearCharacterDraft() {
    state.editingCharacterId = null;
    characterFieldIds.forEach((id) => setInputValue(id, ""));
    $("#characterName")?.focus();
  }

  function saveCharacterCard() {
    const card = normalizeCharacterCard(characterDraftFromForm());
    if (!card.name || !card.role || !card.traits || !card.catchphrases.length || !card.boundary) {
      throw new Error("请至少填写角色名、身份定位、鲜明特质、口头禅和底线。");
    }
    const project = currentProject();
    const existing = (project.characterCards || []).find((item) => item.id === state.editingCharacterId)
      || (project.characterCards || []).find((item) => item.name === card.name);
    if (existing) Object.assign(existing, card, { id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
    else project.characterCards.push(card);
    persistProjects();
    renderCharacterCards();
    renderCreativeAssetPicker();
    renderProject();
    clearCharacterDraft();
    setStatus(existing ? `已更新角色卡：${card.name}` : `已保存角色卡：${card.name}`);
  }

  function renderCharacterCards() {
    const target = $("#characterLibrary");
    if (!target) return;
    const cards = currentProject()?.characterCards || [];
    $("#characterCardCount").textContent = `${cards.length} 个角色`;
    target.innerHTML = cards.length ? cards.map((card) => `
      <article class="library-card character-card">
        <div class="library-card-meta"><span>${escapeHtml(card.role || "角色")}</span><span>${escapeHtml(card.contrast || "待补反差")}</span></div>
        <h4>${escapeHtml(card.name)}</h4>
        <p>${escapeHtml(card.traits)}</p>
        <blockquote>${escapeHtml(card.catchphrases?.[0] || "尚未设置口头禅")}</blockquote>
        <p><strong>说话指纹：</strong>${escapeHtml([card.speechPattern, card.addressStyle].filter(Boolean).join("；") || "待补")}</p>
        <p><strong>压力/破绽：</strong>${escapeHtml([card.pressureResponse, card.lieTell].filter(Boolean).join("；") || "待补")}</p>
        <p><strong>动作：</strong>${escapeHtml(card.mannerism || "待补")}</p><p><strong>笑点触发：</strong>${escapeHtml(card.comedyTrigger || "待补")}</p>
        <div class="library-card-actions"><button class="small-action ${state.activeCharacterIds.includes(card.id) ? "is-active" : ""}" data-character-use="${escapeHtml(card.id)}">${state.activeCharacterIds.includes(card.id) ? "移出本集" : "加入本集"}</button><button class="small-action" data-character-edit="${escapeHtml(card.id)}">编辑</button><button class="small-action danger-action" data-character-delete="${escapeHtml(card.id)}">移除</button></div>
      </article>`).join("") : `<p class="helper">还没有结构化角色卡。可以先填写名字和定位，再让 DeepSeek 补全鲜明特点。</p>`;
    renderRecastAvailability();
  }

  async function generateCharacterDraft() {
    const operation = beginAiOperation("角色卡起草");
    try {
      setStatus("DeepSeek 正在设计角色反差、口头禅和可重复笑点...");
      const initialResponse = await apiRequest("/api/character-card", { input: generationContext({ ...getInput(), characterDraft: characterDraftFromForm() }, "character") });
      const response = await resolveAiJob(initialResponse, "角色卡");
      assertActiveAiOperation(operation);
      applyCharacterDraft(response.result?.card || response.result);
      setStatus(`角色卡草稿已生成，请确认后保存 ${nowTime()} · ${response.model || "model"}${usageSuffix(response)}`);
    } finally {
      endAiOperation(operation);
    }
  }

  function useCharacterCard(id) {
    const card = (currentProject()?.characterCards || []).find((item) => item.id === id);
    if (!card) throw new Error("没有找到这个角色。");
    if (state.activeCharacterIds.includes(id)) {
      state.activeCharacterIds = state.activeCharacterIds.filter((item) => item !== id);
      const remainingRoles = $("#roles").value.split("\n").filter((line) => !line.trim().startsWith(`${card.name}：`));
      setInputValue("roles", remainingRoles.join("\n"));
      renderCharacterCards();
      renderCreativeAssetPicker();
      markBeatSheetStale();
      saveDraft(false);
      setStatus(`已把角色“${card.name}”移出本集`);
      return;
    }
    const addition = characterRoleLine(card);
    const current = $("#roles").value.trim();
    if (!current.includes(`${card.name}：`)) setInputValue("roles", [current, addition].filter(Boolean).join("\n"));
    state.activeCharacterIds.push(id);
    renderCharacterCards();
    renderCreativeAssetPicker();
    markBeatSheetStale();
    saveDraft(false);
    setStatus(`已把角色“${card.name}”加入本集`);
  }

  function deleteCharacterCard(id) {
    const project = currentProject();
    project.characterCards = (project.characterCards || []).filter((item) => item.id !== id);
    state.activeCharacterIds = state.activeCharacterIds.filter((item) => item !== id);
    syncActiveAssetsToInputs();
    markBeatSheetStale();
    persistProjects();
    renderCharacterCards();
    renderCreativeAssetPicker();
    renderProject();
    setStatus("已移除角色卡");
  }

  function currentProject() {
    return state.projects.find((project) => project.id === state.currentProjectId) || state.projects[0] || null;
  }

  async function persistProjects() {
    const revision = ++projectWriteRevision;
    const snapshot = typeof structuredClone === "function"
      ? structuredClone(state.projects)
      : JSON.parse(JSON.stringify(state.projects));
    setSaveState("saving");
    try {
      await archiveSync.save(snapshot);
      persistedProjectRevision = Math.max(persistedProjectRevision, revision);
      if (persistedProjectRevision === projectWriteRevision) setSaveState("saved");
      return true;
    } catch (error) {
      setSaveState("error");
      setStatus(error.code === "LOCAL_VERSION_CONFLICT" ? error.message : "项目档案保存失败：浏览器本地存储空间可能已满", true);
      return false;
    }
  }

  async function loadProjects() {
    try {
      const stored = await archiveSync.load();
      state.projects = Array.isArray(stored.projects) ? stored.projects : [];
    } catch (_) {
      state.projects = [];
    }
    if (!state.projects.length) state.projects = [createProjectRecord("洛克王国短剧项目")];
    state.projects = state.projects.map((source) => {
      const project = projectDomain.migrateProjectRecord(source, defaultBible);
      project.characterCards = project.characterCards.map(normalizeCharacterCard);
      return project;
    });
    state.currentProjectId = state.projects.some((project) => project.id === state.currentProjectId)
      ? state.currentProjectId
      : state.projects[0].id;
    await persistProjects();
  }

  function renderCloudArchive() {
    const status = $("#cloudArchiveStatus");
    const target = $("#cloudArchiveVersions");
    if (!status || !target) return;
    status.textContent = state.cloudArchive.message || "云端备份待连接";
    status.dataset.state = state.cloudArchive.state || "idle";
    const versions = state.cloudArchive.versions || archiveSync.getCloudVersions();
    target.innerHTML = versions.length ? versions.map((item) => `
      <article class="cloud-version-row">
        <div><strong>恢复点 v${escapeHtml(item.revision)}</strong><span>${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false }) : "时间未知")} · ${escapeHtml(item.projectCount || 0)} 个项目</span></div>
        <button class="small-action" type="button" data-cloud-restore="${escapeHtml(item.revision)}">恢复此版本</button>
      </article>`).join("") : `<p class="helper">尚无云端恢复点。点击“立即备份”创建第一版。</p>`;
  }

  async function refreshCloudArchive(interactive = true) {
    const result = await archiveSync.listCloud({ interactive });
    state.cloudArchive.versions = result.versions;
    renderCloudArchive();
    return result;
  }

  async function backupCloudNow() {
    const saved = await persistProjects();
    if (!saved) throw new Error("本地档案存在写入冲突，云端备份已停止。");
    await archiveSync.backupNow(state.projects, { interactive: true });
    await refreshCloudArchive(false);
  }

  async function restoreCloudArchive(revision) {
    if (!window.confirm(`确定恢复云端 v${revision}？当前本地内容会先保留为云端已有版本，但未备份的本地改动将被替换。`)) return;
    await archiveSync.backupNow(state.projects, { interactive: true });
    const result = await archiveSync.loadCloud(revision, { interactive: true });
    const projects = Array.isArray(result.archive?.projects) ? result.archive.projects : [];
    if (!projects.length) throw new Error("该恢复点不包含有效项目。");
    state.projects = projects.map((source) => {
      const project = projectDomain.migrateProjectRecord(source, defaultBible);
      project.characterCards = project.characterCards.map(normalizeCharacterCard);
      return project;
    });
    state.currentProjectId = state.projects[0].id;
    resetCurrentCreation();
    await archiveSync.save(state.projects, { force: true, cloud: false });
    renderProject(); renderBible(); renderCharacterCards(); renderMemeLibrary(); renderCreativeAssetPicker(); renderAssets(); renderConsistency();
    await saveDraft(false);
    setStatus(`已恢复云端恢复点 v${revision}`);
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

  function generationContext(input, modelScope = "script") {
    const project = currentProject();
    const latestReview = (project?.episodes || [])
      .filter((episode) => episode.review?.status === "reviewed" || episode.review?.status === "published")
      .sort((a, b) => String(b.review?.updatedAt || "").localeCompare(String(a.review?.updatedAt || "")))[0]?.review || null;
    return {
      ...input,
      aiModel: state.aiModels[modelScope] || "deepseek-v4-flash",
      aiModels: { ...state.aiModels },
      projectName: project?.name || "未命名短剧项目",
      projectLogline: project?.logline || "",
      projectBible: project?.bible || defaultBible,
      projectContinuity: projectContinuity(project, input.episodeNumber),
      projectAssets: (project?.assets || []).slice(-24),
      projectMemes: (project?.memes || []).filter((item) => (input.activeMemeIds || state.activeMemeIds).includes(item.id)).slice(0, 6),
      projectCharacterCards: (project?.characterCards || []).filter((item) => (input.activeCharacterIds || state.activeCharacterIds).includes(item.id)).slice(0, 8),
      projectSeriesLedger: project?.seriesLedger || {},
      projectCanonSources: (project?.canonSources || []).slice(-30),
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

  function bibleTemplate(templateKey) {
    const input = getInput();
    const names = episodePlanner.roleNames(input.roles);
    const lead = names[0] || "主角洛克";
    const partner = names[1] || "搭档精灵";
    const scene = input.scene || "当前探索区域";
    const shared = {
      abilities: `${partner}：核心能力只能解决局部问题；连续使用会进入疲劳状态，情绪失控时准确率下降。在${scene}之外使用时效果减弱，不能突然获得未铺垫的新能力。`,
      worldRules: `1. 每个区域任务都要付出可见代价，奖励不能凭空出现。\n2. 传送点只能连接已经探索并稳定的区域，危机中强行传送会丢失一件关键物品。\n3. 精灵能拒绝指令，关系变化会影响配合，但不能直接突破能力边界。\n4. 区域首领与环境规则绑定，必须先理解场景机制，再解决战斗或任务。`,
      hookRules: "前 3 秒先展示异常结果，不解释背景；每个 AI 视频制作段只完成一个信息或主动作变化，段尾保留明确的动作承接点；中段至少两次改变观众判断；结尾只揭开一个新事实，并留下下一集必须执行的问题。",
    };
    const templates = {
      comedy: {
        characters: `${lead}：行动快于思考，想证明自己能独立完成区域任务；嘴硬、怕丢脸，越慌越装镇定；底线是不拿精灵当工具。\n${partner}：观察细、吐槽准，表面嫌弃但会在关键时刻补救；弱点是过度相信自己的判断；不能替${lead}无代价收拾残局。`,
        relations: `${lead} ↔ ${partner}：互相嫌弃式搭档，当前信任中等；共同秘密是第一次任务失败并非操作失误；每集通过一次“误会 -> 配合 -> 留下新账”推进关系。`,
        antagonist: "错序商人：收集冒险者犯错后产生的情绪能量，擅长把正常任务规则错位；目标是让所有人依赖他的捷径，底线是不直接伤害精灵；与主角的私人连接是他掌握第一次任务失败的完整记录。",
        mainConflict: `${lead}想靠捷径成为可靠的探索者，却不断发现所谓捷径正在破坏${scene}的任务秩序。主线依次升级为个人翻车、搭档失信、区域规则混乱、必须公开第一次失败真相；阶段终点是两人主动拒绝捷径，但发现幕后规则仍在扩散。`,
      },
      mystery: {
        characters: `${lead}：执着寻找一段被删去的探索记录，冷静外表下害怕再次失去伙伴；习惯先观察异常细节；底线是不牺牲无辜精灵换取真相。\n${partner}：能感知环境中的情绪残响，但每次读取都会短暂混淆自己的记忆；不愿承认害怕被替代。`,
        relations: `${lead} ↔ ${partner}：高度依赖却互相隐瞒；共同秘密是两人都见过同一段不存在于地图的道路；每次使用残响能力，信任和真相必须一增一减。`,
        antagonist: "回声收藏家：相信痛苦记忆会阻碍精灵成长，因此偷偷封存他人的记忆；手段温和但后果危险；底线是不伪造记忆；他曾救过搭档精灵，因此双方不是纯粹敌对。",
        mainConflict: `${lead}追查${scene}不断出现的“第二份探索记录”，逐步发现记录、搭档记忆和区域任务来自同一场旧事故。冲突从真假记录升级到关系互疑、能力代价、区域共同记忆被抽走；阶段终点是找回真相，却必须决定是否公开。`,
      },
      ensemble: {
        characters: `${lead}：临时小队发起人，渴望得到所有人认可，擅长冲锋却不擅长分配责任；底线是不抛下掉队成员。\n${partner}：团队节奏控制者，能力稳定但不愿成为谁的附属；最怕自己的判断拖累全队。\n其他成员：每人必须拥有独立目标、能力限制和一次主导解决问题的机会。`,
        relations: `${lead} ↔ ${partner}：从指挥与执行转为平等搭档；小队成员之间存在资源竞争和共同亏欠；每集至少推进一组关系，不允许所有人同时无条件支持主角。`,
        antagonist: "逐风裁定者：通过极端任务筛选所谓最强探索队，目标是阻止更大区域灾害；手段是制造互斥选择，底线是遵守自己公布的规则；他与队内一名成员有未公开的师徒关系。",
        mainConflict: `临时小队要在${scene}完成一系列越来越相互矛盾的区域挑战。主线从争夺队内位置升级为能力克制、秘密曝光、团队必须淘汰一人；阶段终点是全员拒绝裁定规则，自创一条代价更高的新路线。`,
      },
    };
    return { ...shared, ...(templates[templateKey] || templates.comedy) };
  }

  async function applyBibleDraft(bible, sourceLabel) {
    const keys = ["characters", "abilities", "relations", "antagonist", "worldRules", "mainConflict", "hookRules"];
    if (!bible || keys.some((key) => !String(bible[key] || "").trim())) throw new Error("短剧圣经草案不完整，请重新生成。");
    const project = currentProject();
    project.bible = Object.fromEntries(keys.map((key) => [key, String(bible[key]).trim()]));
    project.updatedAt = new Date().toISOString();
    await persistProjects();
    renderBible();
    renderProject();
    setStatus(`${sourceLabel}已写入并保存到当前项目，可以继续修改`);
  }

  async function generateBibleDraft() {
    const operation = beginAiOperation("短剧圣经起草");
    try {
      setStatus("DeepSeek 正在根据当前角色、场景和系列方向起草短剧圣经...");
      const initialResponse = await apiRequest("/api/bible", { input: generationContext(getInput(), "bible") });
      const response = await resolveAiJob(initialResponse, "短剧圣经");
      assertActiveAiOperation(operation);
      await applyBibleDraft(response.result?.bible, "DeepSeek 短剧圣经草案");
      setStatus(`短剧圣经已生成并保存 ${nowTime()} · ${response.model || "model"}${usageSuffix(response)}`);
    } finally {
      endAiOperation(operation);
    }
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
      ["策划批次", `${(project.planBatches || []).length} 批`],
      ["已完成复盘", `${reviewed} 集`],
      ["角色卡", `${(project.characterCards || []).length} 个`],
      ["项目梗库", `${(project.memes || []).length} 条`],
      ["可复用资产", `${(project.assets || []).length} 条`],
    ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    const target = $("#projectEpisodeList");
    target.innerHTML = episodes.length
      ? episodes.slice().sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber)).map((episode) => `
        <article class="episode-card">
          <div class="episode-number">EP ${escapeHtml(episode.episodeNumber)}</div>
          <div>
            <div class="history-meta"><span>${escapeHtml(episode.review?.status || "draft")}</span><span>${episode.storyboard?.length || 0} 个视频段</span><span>${(episode.versions || []).length} 个剧本版本</span></div>
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
    renderPlanHistory();
    renderCharacterCards();
    renderMemeLibrary();
    renderSeriesLedger();
    renderCanonSources();
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
    renderCharacterCards();
    renderMemeLibrary();
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
      exportVersion: projectDomain.PROJECT_SCHEMA_VERSION,
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
        if (Number(parsed.exportVersion || 1) > projectDomain.PROJECT_SCHEMA_VERSION) {
          throw new Error("这个备份来自更高版本，请先升级应用后再导入。");
        }
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
          assets: Array.isArray(imported.assets) ? imported.assets.map((asset) => ({ ...asset })) : [],
          memes: Array.isArray(imported.memes) ? imported.memes.map((meme) => ({ ...meme })) : [],
          characterCards: Array.isArray(imported.characterCards) ? imported.characterCards.map((card) => normalizeCharacterCard(card)) : [],
          planBatches: Array.isArray(imported.planBatches) ? imported.planBatches.map((batch) => ({
            ...batch,
            plans: (batch.plans || []).map((plan) => ({ ...plan, plan: { ...(plan.plan || {}) } })),
          })) : [],
          creativeMixBatches: Array.isArray(imported.creativeMixBatches) ? imported.creativeMixBatches : [],
          beatSheetBatches: Array.isArray(imported.beatSheetBatches) ? imported.beatSheetBatches : [],
          episodes: Array.isArray(imported.episodes) ? imported.episodes : [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        Object.assign(project, projectDomain.migrateProjectRecord(project, defaultBible));
        projectDomain.rekeyImportedProject(project);
        state.projects.unshift(project);
        state.currentProjectId = project.id;
        resetCurrentCreation();
        persistProjects();
        renderProject(); renderBible(); renderCharacterCards(); renderMemeLibrary(); renderAssets(); renderConsistency(); saveDraft(false);
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
    restoreActiveSelections(episode.input);
    restoreCreativeWorkflow(episode.input);
    setInputValue("episodeNumber", episode.episodeNumber);
    state.currentEpisodeId = episode.id;
    state.reviewEpisodeId = episode.id;
    state.script = episode.script || null;
    state.storyboard = episode.storyboard || [];
    state.creativePack = episode.creativePack || null;
    state.scriptDoctor = episode.doctorResult || null;
    state.currentHistoryId = episode.historyId || null;
    state.continuationSource = null;
    state.activePlanBatchId = episode.input?.episodePlanRef?.batchId || null;
    state.selectedPlanOptionId = episode.input?.episodePlanRef?.planId || null;
    const episodePlanBatch = (project.planBatches || []).find((batch) => batch.id === state.activePlanBatchId);
    state.planOptions = episodePlanBatch?.plans?.map((option) => ({ ...option, plan: { ...option.plan } })) || [];
    project.updatedAt = new Date().toISOString();
    persistProjects();
    renderPlanSuggestions();
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
    renderScriptDoctor();
    const target = $("#consistencyOutput");
    if (!target) return;
    const report = currentProjectEpisode()?.consistency;
    if (!state.script) {
      target.innerHTML = `<p class="helper">请先生成或打开一集剧本，再执行一致性检查。</p>`;
      return;
    }
    if (!report) {
      target.innerHTML = `<p class="helper">当前集尚未检查。点击“检查当前集”会核对角色性格、口头禅与标志动作、精灵能力、人物关系和上一集悬念承接。</p>`;
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
      const input = generationContext({ ...getInput(), script: state.script }, "continuity");
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

  function normalizeSeriesLedger(value = {}) {
    const list = (key) => Array.isArray(value[key]) ? value[key] : [];
    return {
      openQuestions: list("openQuestions"), resolvedQuestions: list("resolvedQuestions"),
      characterStates: list("characterStates"), abilityStates: list("abilityStates"), propStates: list("propStates"),
      antagonistProgress: String(value.antagonistProgress || "").trim(), recurringGags: list("recurringGags"),
      nextObligations: list("nextObligations").map((item) => typeof item === "string" ? item : item?.content || item?.obligation || "").filter(Boolean),
      throughEpisode: Math.max(0, Number(value.throughEpisode || 0)),
      updatedAt: value.updatedAt || new Date().toISOString(),
    };
  }

  function ledgerItemText(item, preferred = []) {
    if (typeof item === "string") return item;
    const key = preferred.find((name) => item?.[name]);
    const lead = key ? item[key] : item?.name || item?.id || "记录";
    const rest = Object.entries(item || {}).filter(([name, value]) => name !== key && name !== "id" && value).slice(0, 3).map(([, value]) => Array.isArray(value) ? value.join("、") : value);
    return [lead, ...rest].join("｜");
  }

  function renderSeriesLedger() {
    const target = $("#seriesLedgerOutput");
    if (!target) return;
    const project = currentProject();
    const ledger = normalizeSeriesLedger(project?.seriesLedger || {});
    const groups = [
      ["未解悬念", ledger.openQuestions, ["question"]], ["人物现状", ledger.characterStates, ["name"]],
      ["能力与代价", ledger.abilityStates, ["name"]], ["关键道具", ledger.propStates, ["name"]],
      ["重复梗进度", ledger.recurringGags, ["name"]], ["下一集必须承接", ledger.nextObligations, []],
    ];
    const hasContent = groups.some(([, items]) => items.length) || ledger.antagonistProgress;
    target.innerHTML = hasContent ? `
      <div class="ledger-grid">${groups.map(([title, items, keys]) => `<article><h4>${title}</h4>${items.length ? `<ul>${items.slice(0, 8).map((item) => `<li>${escapeHtml(ledgerItemText(item, keys))}</li>`).join("")}</ul>` : `<p>暂无</p>`}</article>`).join("")}
      <article><h4>反派推进</h4><p>${escapeHtml(ledger.antagonistProgress || "暂无")}</p></article></div>`
      : `<p class="helper">归档剧本后点击“AI 更新台账”，系统会把跨集必须记住的信息沉淀在这里。</p>`;
    const history = project?.ledgerVersions || [];
    if ($("#ledgerHistoryCount")) $("#ledgerHistoryCount").textContent = String(history.length);
    if ($("#ledgerHistoryList")) $("#ledgerHistoryList").innerHTML = history.length ? history.slice(0, 10).map((item, index) => `<div class="plan-history-item"><div><strong>${escapeHtml(new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false }))}</strong><span>${escapeHtml(item.model || "model")} · ${item.episodeCount || 0} 集</span></div><button class="small-action" type="button" data-ledger-restore="${index}">恢复</button></div>`).join("") : `<p class="helper">每次 AI 更新都会留下版本。</p>`;
  }

  async function updateSeriesLedger() {
    const project = currentProject();
    if (!project?.episodes?.some((episode) => episode.script)) throw new Error("请先归档至少一集剧本，再更新连载台账。");
    const operation = beginAiOperation("连载台账更新");
    try {
      setStatus("AI 正在核对全部已归档集数并更新连载台账...");
      const projectEpisodes = window.RocoWorkflowCore.ledgerEpisodeBatch(project.episodes, 30);
      const response = await apiRequest("/api/series-ledger", { input: generationContext({ ...getInput(), projectEpisodes }, "ledger") });
      assertActiveAiOperation(operation);
      const ledger = normalizeSeriesLedger(response.result?.ledger || response.result);
      project.seriesLedger = ledger;
      project.ledgerVersions = [{ id: newId("ledger"), createdAt: new Date().toISOString(), model: response.model || "", source: response.source || "", episodeCount: projectEpisodes.length, ledger }, ...(project.ledgerVersions || [])].slice(0, 30);
      project.updatedAt = new Date().toISOString();
      await persistProjects();
      renderSeriesLedger();
      setStatus(`连载台账已更新并留档 ${nowTime()} · ${response.model || "deepseek"}${usageSuffix(response)}`);
    } finally { endAiOperation(operation); }
  }

  function restoreLedgerVersion(index) {
    const project = currentProject();
    const version = project?.ledgerVersions?.[index];
    if (!version) throw new Error("没有找到这个台账版本。");
    project.seriesLedger = normalizeSeriesLedger(version.ledger);
    project.updatedAt = new Date().toISOString();
    persistProjects();
    renderSeriesLedger();
    setStatus("已恢复所选连载台账版本");
  }

  function renderCanonSources() {
    const target = $("#canonSourceLibrary");
    if (!target) return;
    const sources = currentProject()?.canonSources || [];
    if ($("#canonSourceCount")) $("#canonSourceCount").textContent = `${sources.length} 条来源`;
    target.innerHTML = sources.length ? sources.slice().reverse().map((item) => `<article class="asset-card canon-source-card"><span class="asset-type">${escapeHtml(item.type)}</span><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.content)}</p>${item.url ? `<small>${escapeHtml(item.url)}</small>` : ""}</div><button class="small-action danger-action" data-canon-source-delete="${escapeHtml(item.id)}">移除</button></article>`).join("") : `<p class="helper">尚未记录设定来源。建议先录入官方确认内容、项目二设，以及明确禁用的页游设定。</p>`;
  }

  function addCanonSource() {
    const name = $("#canonSourceName").value.trim();
    const content = $("#canonSourceContent").value.trim();
    if (!name || !content) throw new Error("请填写设定名称和具体内容。");
    const project = currentProject();
    project.canonSources.push({ id: newId("canon"), type: $("#canonSourceType").value, name, content, url: $("#canonSourceUrl").value.trim(), createdAt: new Date().toISOString() });
    ["canonSourceName", "canonSourceContent", "canonSourceUrl"].forEach((id) => setInputValue(id, ""));
    persistProjects(); renderCanonSources(); setStatus("手游设定来源已存入当前项目，后续生成会引用它");
  }

  function deleteCanonSource(id) {
    const project = currentProject();
    project.canonSources = (project.canonSources || []).filter((item) => item.id !== id);
    persistProjects(); renderCanonSources(); setStatus("已移除设定来源");
  }

  function renderScriptDoctor() {
    const target = $("#scriptDoctorOutput");
    const applyButton = $("#applyDoctorRevisionBtn");
    if (!target || !applyButton) return;
    const report = state.scriptDoctor?.report || currentProjectEpisode()?.doctorReport || null;
    if (!state.script) {
      target.innerHTML = `<p class="helper">请先生成或打开一集剧本，再执行剧作诊断。</p>`;
      applyButton.hidden = true;
      return;
    }
    if (!report) {
      target.innerHTML = `<p class="helper">当前版本尚未诊断。剧本医生会指出具体问题、证据、修法，并提供一版完整修订稿供你选择。</p>`;
      applyButton.hidden = true;
      return;
    }
    const dimensions = Array.isArray(report.dimensions) ? report.dimensions : [];
    const issues = Array.isArray(report.issues) ? report.issues : [];
    target.innerHTML = `<div class="consistency-summary"><div><h3>${escapeHtml(report.summary || "剧本诊断完成")}</h3><p>${escapeHtml(report.priority || "优先修复最高影响问题")}</p></div><span class="consistency-score">${escapeHtml(report.score ?? "-")}</span></div>
      <div class="doctor-dimensions">${dimensions.map((item) => `<span><strong>${escapeHtml(item.area || "维度")}</strong>${escapeHtml(item.score ?? "-")}</span>`).join("")}</div>
      <div class="consistency-list">${issues.map((item) => `<article class="consistency-item"><strong>${escapeHtml(item.severity || "建议")} · ${escapeHtml(item.area || "剧作")}</strong><div><p>${escapeHtml(item.evidence || item.problem || "")}</p><p>修法：${escapeHtml(item.fix || "")}</p>${[...(item.beatIds || []), ...(item.dialogueIds || [])].length ? `<small>关联：${escapeHtml([...(item.beatIds || []), ...(item.dialogueIds || [])].join("、"))}</small>` : ""}</div></article>`).join("")}</div>`;
    applyButton.hidden = !state.scriptDoctor?.revisedScript;
  }

  async function runScriptDoctor() {
    if (!state.script) throw new Error("请先生成或恢复一个剧本，再执行剧作诊断。");
    const operation = beginAiOperation("剧本医生");
    try {
      setStatus("AI 剧本医生正在诊断人物行动、冲突、台词、笑点和结尾钩子...");
      const response = await apiRequest("/api/script-doctor", { input: generationContext({ ...getInput(), script: state.script }, "doctor") });
      assertActiveAiOperation(operation);
      const report = response.result?.report || {};
      const revisedScript = response.result?.revisedScript || null;
      state.scriptDoctor = {
        report,
        revisedScript,
        response: { source: response.source || "", model: response.model || "" },
        createdAt: new Date().toISOString(),
      };
      const episode = currentProjectEpisode();
      if (episode) {
        const version = activeEpisodeVersion(episode);
        if (version) {
          version.doctorResult = structuredClone(state.scriptDoctor);
          version.doctorReport = report;
        }
        applyEpisodeVersion(episode, version?.id);
        persistProjects();
      }
      renderScriptDoctor();
      switchTab("consistency");
      setStatus(`剧本诊断完成 ${nowTime()} · ${response.model || "deepseek"}${usageSuffix(response)}`);
    } finally { endAiOperation(operation); }
  }

  function applyDoctorRevision() {
    const revisedScript = state.scriptDoctor?.revisedScript;
    if (!revisedScript) throw new Error("当前没有可采用的修订稿。");
    const input = getInput();
    const response = state.scriptDoctor.response || { source: "script-doctor", model: state.aiModels.doctor };
    state.script = normalizeScriptResult({ script: revisedScript }).script;
    state.storyboard = [];
    state.creativePack = window.RocoStudio.generateCreativePack(state.script, input, state.topics);
    const item = addHistoryItem({ mode: "doctor", input, response, projectId: state.currentProjectId, projectName: currentProject()?.name, episodeNumber: input.episodeNumber, generated: { script: state.script, storyboard: [], creativePack: state.creativePack } });
    state.currentHistoryId = item.id;
    upsertProjectEpisode({ mode: "doctor", input, response, generated: { script: state.script, storyboard: [], creativePack: state.creativePack }, historyId: item.id });
    state.scriptDoctor = null;
    persistHistory();
    renderScript(); renderStoryboard(); renderCreativePack(); renderHistory(); renderConsistency(); saveDraft(false);
    switchTab("script");
    setStatus("已采用剧本医生修订稿并新建剧本版本；原稿仍可从版本记录恢复");
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
    if (id === "aiModel") renderAiModelSwitches();
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
    if (mode === "continue") {
      state.continuationSource = { script: state.script, storyboard: [...state.storyboard], episodeId: state.currentEpisodeId };
      setInputValue("episodeNumber", Math.max(Number(getInput().episodeNumber || 0) + 1, nextEpisodeNumber()));
      state.currentEpisodeId = null;
      state.reviewEpisodeId = null;
    }
    applyTopicToInputs(topic);
    applyEpisodePlan({});
    state.planOptions = [];
    state.selectedPlanOptionId = null;
    state.activePlanBatchId = null;
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
      ? `已选择“${topic.title}”，请先确定下一集策划和节拍表，再生成下一集`
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
          ...generationContext(input, "topics"),
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
          ...generationContext(getInput(), "topics"),
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
    return generationClient.request(path, payload);
  }

  async function resolveAiJob(response, label) {
    return generationClient.resolveJob(response, label);
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
    script.innovationPoints = Array.isArray(script.innovationPoints) ? script.innovationPoints : [];
    script.comedyBeats = Array.isArray(script.comedyBeats) ? script.comedyBeats : [];
    script.visualHighlights = Array.isArray(script.visualHighlights) ? script.visualHighlights : [];
    script.assetIntegration = script.assetIntegration && typeof script.assetIntegration === "object" ? script.assetIntegration : { characters: [], memes: [] };
    script.assetIntegration.characters = Array.isArray(script.assetIntegration.characters) ? script.assetIntegration.characters : [];
    script.assetIntegration.memes = Array.isArray(script.assetIntegration.memes) ? script.assetIntegration.memes : [];
    script.hooks = Array.isArray(script.hooks) ? script.hooks : [];
    script.tags = Array.isArray(script.tags) ? script.tags : [];
    return {
      script,
      storyboard: result.storyboard.map((shot, index) => ({
        clipId: shot.clipId || `CLIP-${String(index + 1).padStart(2, "0")}`,
        shot: shot.shot || index + 1,
        beatIds: Array.isArray(shot.beatIds) ? shot.beatIds : [],
        dialogueIds: Array.isArray(shot.dialogueIds) ? shot.dialogueIds : [],
        timeRange: shot.timeRange || "",
        seconds: shot.seconds || "",
        generationSeconds: shot.generationSeconds || shot.seconds || "",
        trimSeconds: shot.trimSeconds || 0,
        generationMode: shot.generationMode || "单场景连续镜头",
        segmentGoal: shot.segmentGoal || "",
        continuityIn: shot.continuityIn || "",
        continuityOut: shot.continuityOut || "",
        beatBreakdown: Array.isArray(shot.beatBreakdown) ? shot.beatBreakdown : [],
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
    script.dialogue = script.dialogue.map((item, index) => ({ ...item, id: item.id || `LINE-${String(index + 1).padStart(2, "0")}`, beatIds: Array.isArray(item.beatIds) ? item.beatIds : [] }));
    script.rhythm = Array.isArray(script.rhythm) ? script.rhythm : [];
    script.reversals = Array.isArray(script.reversals) ? script.reversals : [];
    script.innovationPoints = Array.isArray(script.innovationPoints) ? script.innovationPoints : [];
    script.comedyBeats = Array.isArray(script.comedyBeats) ? script.comedyBeats : [];
    script.visualHighlights = Array.isArray(script.visualHighlights) ? script.visualHighlights : [];
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
      clipId: shot.clipId || `CLIP-${String(index + 1).padStart(2, "0")}`,
      shot: shot.shot || index + 1,
      beatIds: Array.isArray(shot.beatIds) ? shot.beatIds : [],
      dialogueIds: Array.isArray(shot.dialogueIds) ? shot.dialogueIds : [],
      timeRange: shot.timeRange || "",
      seconds: shot.seconds || "",
      generationSeconds: shot.generationSeconds || shot.seconds || "",
      trimSeconds: shot.trimSeconds || 0,
      generationMode: shot.generationMode || "单场景连续镜头",
      segmentGoal: shot.segmentGoal || "",
      continuityIn: shot.continuityIn || "",
      continuityOut: shot.continuityOut || "",
      beatBreakdown: (Array.isArray(shot.beatBreakdown) ? shot.beatBreakdown : []).map((beat) => ({
        range: beat?.range || "",
        content: beat?.content || "",
      })),
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
      renderRecastAvailability();
      return;
    }
    $("#scriptTitle").textContent = script.title;
    $("#scriptOutput").innerHTML = uiTemplates.script(script);
    renderRecastAvailability();
  }

  function renderRecastAvailability() {
    const button = $("#openRecastBtn");
    const panel = $("#recastPanel");
    if (!button || !panel) return;
    const cardCount = currentProject()?.characterCards?.length || 0;
    button.disabled = !state.script || !cardCount || Boolean(state.activeAiOperation);
    button.title = !state.script
      ? "请先生成或恢复一个剧本"
      : !cardCount
        ? "请先在角色库创建角色卡"
        : "把剧本中的一个或多个人物替换成角色库人物";
    if (!state.script || !cardCount) panel.hidden = true;
    if (!panel.hidden) renderRecastMappings();
  }

  function renderRecastMappings() {
    const target = $("#recastMappingList");
    if (!target) return;
    const previous = new Map($$("[data-recast-source]").map((select) => [select.dataset.recastSource, select.value]));
    const characters = state.script?.characters || [];
    const cards = currentProject()?.characterCards || [];
    target.innerHTML = characters.map((character) => {
      const options = cards
        .filter((card) => card.name !== character.name)
        .map((card) => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)} · ${escapeHtml(card.role || card.traits || "角色卡")}</option>`)
        .join("");
      return `<div class="recast-mapping-row"><strong>${escapeHtml(character.name)}</strong><span>→</span><select data-recast-source="${escapeHtml(character.name)}" aria-label="将${escapeHtml(character.name)}替换为角色库人物"><option value="">保持不变</option>${options}</select></div>`;
    }).join("");
    $$("[data-recast-source]").forEach((select) => {
      const saved = previous.get(select.dataset.recastSource);
      if (saved && Array.from(select.options).some((option) => option.value === saved)) select.value = saved;
    });
  }

  function openRecastPanel() {
    if (!state.script) throw new Error("请先生成或恢复一个剧本。");
    if (!(currentProject()?.characterCards || []).length) throw new Error("角色库还没有角色卡，请先到“设定库 → 角色库”创建人物。");
    $("#recastPanel").hidden = false;
    renderRecastMappings();
    $("#recastPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function collectRecastMappings() {
    const cardMap = new Map((currentProject()?.characterCards || []).map((card) => [card.id, card]));
    const mappings = $$("[data-recast-source]")
      .filter((select) => select.value)
      .map((select) => ({ fromName: select.dataset.recastSource, targetCharacterId: select.value, targetCharacter: cardMap.get(select.value) }));
    if (!mappings.length) throw new Error("请至少为一个剧本角色选择新的角色卡。");
    if (mappings.some((item) => !item.targetCharacter)) throw new Error("所选角色卡已经不存在，请重新选择。");
    if (mappings.length > 4) throw new Error("一次最多替换 4 个角色，请分两次完成。");
    if (new Set(mappings.map((item) => item.targetCharacterId)).size !== mappings.length) throw new Error("不同原角色不能替换成同一个目标角色。");
    const currentNames = new Set((state.script?.characters || []).map((item) => item.name));
    const conflict = mappings.find((item) => currentNames.has(item.targetCharacter?.name));
    if (conflict) throw new Error(`“${conflict.targetCharacter.name}”已经在当前剧本中，请选择尚未出场的角色卡。`);
    return mappings;
  }

  function updateRoleInputsAfterRecast(mappings) {
    const project = currentProject();
    const sourceNames = new Set(mappings.map((item) => item.fromName));
    const targetIds = mappings.map((item) => item.targetCharacterId);
    const sourceCardIds = new Set((project?.characterCards || []).filter((card) => sourceNames.has(card.name)).map((card) => card.id));
    const remainingActive = state.activeCharacterIds.filter((id) => !sourceCardIds.has(id) && !targetIds.includes(id));
    state.activeCharacterIds = [...targetIds, ...remainingActive].slice(0, 4);
    const remainingRoleLines = $("#roles").value.split("\n").filter((line) => {
      const name = line.split(/[：:]/)[0].trim();
      return line.trim() && !sourceNames.has(name);
    });
    setInputValue("roles", remainingRoleLines.join("\n"));
    syncActiveAssetsToInputs();
    renderCreativeAssetPicker();
    renderCharacterCards();
  }

  async function applyScriptRecast() {
    const mappings = collectRecastMappings();
    const operation = beginAiOperation("智能换角");
    try {
      const input = getInput();
      const targetIds = mappings.map((item) => item.targetCharacterId);
      setStatus(`AI 正在替换 ${mappings.length} 个角色，并保持原剧情结构...`);
      const initialResponse = await apiRequest("/api/recast-script", {
        input: {
          ...generationContext({ ...input, activeCharacterIds: targetIds }, "recast"),
          script: state.script,
          recastMappings: mappings.map(({ fromName, targetCharacterId }) => ({ fromName, targetCharacterId })),
        },
      });
      const response = await resolveAiJob(initialResponse, "智能换角");
      assertActiveAiOperation(operation);
      const generated = normalizeScriptResult(response.result);
      updateRoleInputsAfterRecast(mappings);
      const versionInput = getInput();
      state.script = generated.script;
      state.storyboard = [];
      state.scriptDoctor = null;
      state.creativePack = window.RocoStudio.generateCreativePack(state.script, versionInput, state.topics);
      const item = addHistoryItem({
        mode: "recast",
        input: versionInput,
        response,
        projectId: state.currentProjectId,
        projectName: currentProject()?.name,
        episodeNumber: versionInput.episodeNumber,
        generated: { ...generated, creativePack: state.creativePack },
      });
      state.currentHistoryId = item.id;
      upsertProjectEpisode({ mode: "recast", input: versionInput, response, generated: { ...generated, creativePack: state.creativePack }, historyId: item.id });
      persistHistory();
      renderScript(); renderStoryboard(); renderCreativePack(); renderHistory(); renderConsistency(); renderExample();
      saveDraft(false);
      $("#recastPanel").hidden = true;
      pulseResult();
      const versionCount = currentProjectEpisode()?.versions?.length || 1;
      setStatus(`智能换角完成，已保存为剧本 v${versionCount}；原版本及其分镜仍可在项目档案中恢复。${usageSuffix(response)}`);
    } finally {
      endAiOperation(operation);
    }
  }

  function renderTable(target, rows, columns) {
    target.innerHTML = uiTemplates.table(rows, columns);
  }

  function renderStoryboard() {
    refreshCreationActions();
    $("#storyboardTable").innerHTML = uiTemplates.storyboard(state.storyboard, Boolean(state.script));
    renderStoryboardHistory();
  }

  function renderStoryboardHistory() {
    const target = $("#storyboardHistory");
    if (!target) return;
    const episode = currentProjectEpisode();
    const scriptVersion = activeEpisodeVersion(episode);
    const versions = scriptVersion?.storyboardVersions || [];
    if (!state.script) {
      target.innerHTML = "";
      return;
    }
    if (!versions.length) {
      target.innerHTML = `<span>《${escapeHtml(state.script.title || "当前剧本")}》还没有对应分镜版本，首次生成后会自动留档。</span>`;
      return;
    }
    const scriptVersionIndex = (episode.versions || []).findIndex((version) => version.id === episode.activeVersionId) + 1;
    target.innerHTML = `<span>《${escapeHtml(state.script.title || "当前剧本")}》剧本 v${scriptVersionIndex} 对应分镜：</span>${versions.map((version, index) => {
      const total = (version.storyboard || []).reduce((sum, segment) => sum + Number(segment.seconds || 0), 0);
      const createdAt = new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false });
      return `<button class="small-action ${version.id === scriptVersion.activeStoryboardVersionId ? "is-active-version" : ""}" type="button" data-storyboard-version="${escapeHtml(version.id)}" title="${escapeHtml(createdAt)} · ${escapeHtml(version.model || "model")}">分镜 v${index + 1} · ${(version.storyboard || []).length} 段/${total}秒</button>`;
    }).join("")}`;
  }

  function restoreStoryboardVersion(id) {
    const episode = currentProjectEpisode();
    const restored = applyStoryboardVersion(episode, id);
    if (!restored) throw new Error("没有找到这个分镜版本，或它不属于当前剧本版本。");
    state.storyboard = restored.storyboard || [];
    currentProject().updatedAt = episode.updatedAt;
    persistProjects();
    renderStoryboard();
    renderExample();
    saveDraft(false);
    setStatus(`已恢复当前剧本对应的分镜版本，共 ${state.storyboard.length} 个视频段`);
  }

  function storyboardSegmentText(segment) {
    return [
      `第 ${segment.shot} 段｜${segment.timeRange || `${segment.seconds || 10}秒`}`,
      `生成规格：${segment.generationMode || "单场景连续镜头"}｜生成 ${segment.generationSeconds || segment.seconds || ""} 秒｜成片保留 ${segment.seconds || ""} 秒${Number(segment.trimSeconds || 0) ? `｜尾部裁剪 ${segment.trimSeconds} 秒` : ""}`,
      `所属剧本：${state.script?.title || "未命名剧本"}`,
      `关联ID：${segment.clipId || ""}｜${(segment.beatIds || []).join("、")}｜${(segment.dialogueIds || []).join("、")}`,
      `本段任务：${segment.segmentGoal || ""}`,
      `角色：${segment.characters || ""}`,
      `场景：${segment.scene || ""}`,
      `段内节拍：${(segment.beatBreakdown || []).map((beat) => `${beat.range} ${beat.content}`).join("；")}`,
      `画面与动作：${segment.visual || ""}；${segment.action || ""}`,
      `台词/旁白：${segment.line || ""}`,
      `字幕：${segment.subtitle || ""}`,
      `景别与运动：${segment.scale || ""}；${segment.movement || ""}`,
      `声音：${segment.sound || ""}`,
      `承接入点：${segment.continuityIn || ""}`,
      `承接出点：${segment.continuityOut || ""}`,
      `AI 视频提示词：${segment.visualPrompt || ""}`,
      `关联资产：${segment.assetLinks || ""}`,
      `制作备注：${segment.assetNote || ""}`,
      `素材状态：${segment.assetStatus || "待制作"}`,
    ].join("\n");
  }

  async function copyStoryboardSegment(index) {
    const segment = state.storyboard[index];
    if (!segment) throw new Error("没有找到这个视频段。");
    await navigator.clipboard.writeText(storyboardSegmentText(segment));
    setStatus(`已复制第 ${segment.shot} 段，可直接粘贴到 AI 视频生成工具`);
  }

  function updateStoryboardProductionField(index, field, value) {
    const shot = state.storyboard[index];
    if (!shot || !["assetLinks", "assetNote", "assetStatus"].includes(field)) return;
    shot[field] = value;
    const episode = currentProjectEpisode();
    const version = activeEpisodeVersion(episode);
    if (episode && version) {
      version.storyboard = state.storyboard;
      const storyboardVersion = (version.storyboardVersions || []).find((item) => item.id === version.activeStoryboardVersionId);
      if (storyboardVersion) storyboardVersion.storyboard = state.storyboard;
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
    const archived = window.RocoWorkflowCore.findArchivedVersion(state.projects, item.id);
    if (archived) {
      state.currentProjectId = archived.project.id;
      applyEpisodeVersion(archived.episode, archived.version.id);
      archived.project.updatedAt = new Date().toISOString();
      state.currentEpisodeId = archived.episode.id;
      state.reviewEpisodeId = state.currentEpisodeId;
      persistProjects();
    } else if (item.projectId && state.projects.some((project) => project.id === item.projectId)) {
      state.currentProjectId = item.projectId;
      state.currentEpisodeId = null;
      state.reviewEpisodeId = null;
    }
    Object.entries(item.input || {}).forEach(([key, value]) => {
      if (key === "continueInstruction" && keepInstruction) return;
      setInputValue(key, value);
    });
    applyEpisodePlan(item.input?.episodePlan);
    restoreActiveSelections(item.input);
    restoreCreativeWorkflow(item.input);
    state.script = item.script;
    state.storyboard = item.storyboard || [];
    state.creativePack = item.creativePack || null;
    state.scriptDoctor = archived?.version?.doctorResult || null;
    state.currentHistoryId = item.id || null;
    state.continuationSource = null;
    state.activePlanBatchId = item.input?.episodePlanRef?.batchId || null;
    state.selectedPlanOptionId = item.input?.episodePlanRef?.planId || null;
    const historyPlanBatch = (currentProject()?.planBatches || []).find((batch) => batch.id === state.activePlanBatchId);
    state.planOptions = historyPlanBatch?.plans?.map((option) => ({ ...option, plan: { ...option.plan } })) || [];
    renderPlanSuggestions();
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
    continueEpisode();
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
        <p>共 ${state.storyboard.length} 个连续视频段，总时长 ${state.storyboard.reduce((sum, shot) => sum + Number(shot.seconds), 0)} 秒。首段：${escapeHtml(state.storyboard[0].visual)}；尾段：${escapeHtml(state.storyboard[state.storyboard.length - 1].subtitle)}。</p>
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
    if (!state.beatSheetApproved || state.beatSheet.length !== 8) {
      throw new Error("请先生成并确认一版完整的剧情节拍表，再生成正式剧本。");
    }
    const continuationSource = state.continuationSource;
    if (mode === "continue" && !continuationSource?.script && !state.script) {
      throw new Error("还没有可续写的剧本，请先生成一集。");
    }
    const operation = beginAiOperation(mode === "continue" ? "剧本续写" : "剧本生成");
    try {
      setStatus(mode === "continue" ? "AI 续写剧本中..." : "AI 生成剧本中...");
      if (mode === "continue" && !continuationSource) {
        const nextNumber = Math.max(Number(input.episodeNumber || 0) + 1, nextEpisodeNumber());
        input.episodeNumber = nextNumber;
        setInputValue("episodeNumber", nextNumber);
        state.currentEpisodeId = null;
      }
      const previousScript = mode === "continue" ? continuationSource?.script || state.script : null;
      const previousStoryboard = mode === "continue" ? continuationSource?.storyboard || state.storyboard : null;
      const initialResponse = await apiRequest("/api/script", {
        input: {
          ...generationContext(input, "script"),
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
      state.scriptDoctor = null;
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
      state.continuationSource = null;
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
      setStatus("AI 正在分批生成详细分镜并自动合并，请保持页面开启...");
      const initialResponse = await apiRequest("/api/storyboard", {
        input: {
          ...generationContext(input, "storyboard"),
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
      setStatus(`AI 已生成 ${state.storyboard.length} 个连续视频段 ${nowTime()} · ${response.source || "provider"} · ${response.model || "model"}${usageSuffix(response)}`);
    } finally {
      endAiOperation(operation);
    }
  }

  async function generateAll() {
    await runGeneration(state.continuationSource ? "continue" : "new");
  }

  function continueEpisode() {
    if (!state.script) throw new Error("请先生成或恢复上一集剧本。");
    state.continuationSource = {
      script: state.script,
      storyboard: [...state.storyboard],
      episodeId: state.currentEpisodeId,
    };
    const nextNumber = Math.max(Number(getInput().episodeNumber || 0) + 1, nextEpisodeNumber());
    setInputValue("episodeNumber", nextNumber);
    state.currentEpisodeId = null;
    state.reviewEpisodeId = null;
    applyEpisodePlan({});
    state.planOptions = [];
    state.selectedPlanOptionId = null;
    state.activePlanBatchId = null;
    state.beatSheet = [];
    state.beatSheetApproved = false;
    state.activeBeatSheetBatchId = null;
    renderPlanSuggestions();
    renderBeatSheet();
    refreshCreationActions();
    saveDraft(false);
    document.querySelector(".episode-plan-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus(`已准备第 ${nextNumber} 集，请先选择角色与梗、确定策划和节拍表，再生成下一集`);
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
      activePlanBatchId: state.activePlanBatchId,
      selectedPlanOptionId: state.selectedPlanOptionId,
      topics: state.topics,
      analysis: state.analysis,
      competitors: state.competitors,
      memeIdeas: state.memeIdeas,
      continuationSource: state.continuationSource,
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
      state.activePlanBatchId = draft.activePlanBatchId || draft.input?.episodePlanRef?.batchId || null;
      state.selectedPlanOptionId = draft.selectedPlanOptionId || draft.input?.episodePlanRef?.planId || null;
      Object.entries(draft.input || {}).forEach(([key, value]) => {
        const el = document.getElementById(key);
        if (el) el.value = value;
      });
      restoreAiModels(draft.input);
      applyEpisodePlan(draft.input?.episodePlan);
      restoreActiveSelections(draft.input);
      restoreCreativeWorkflow(draft.input);
      $("#competitorCsv").value = draft.competitorCsv || "";
      state.topics = normalizeTopicList(draft.topics);
      state.analysis = draft.analysis || null;
      state.competitors = Array.isArray(draft.competitors) ? draft.competitors : [];
      state.memeIdeas = Array.isArray(draft.memeIdeas) ? draft.memeIdeas : [];
      state.continuationSource = draft.continuationSource && typeof draft.continuationSource === "object" ? draft.continuationSource : null;
      const episode = currentProjectEpisode();
      if (episode) {
        applyEpisodeVersion(episode, episode.activeVersionId);
        state.script = episode.script || null;
        state.storyboard = Array.isArray(episode.storyboard) ? episode.storyboard : [];
        state.creativePack = episode.creativePack || null;
        state.scriptDoctor = episode.doctorResult || null;
      } else {
        // Older drafts embedded content directly; keep this one-time migration fallback.
        state.script = draft.script || null;
        state.storyboard = Array.isArray(draft.storyboard) ? draft.storyboard : [];
        state.creativePack = draft.creativePack || null;
      }
      state.currentHistoryId = draft.currentHistoryId || null;
      const activeBatch = (currentProject()?.planBatches || []).find((batch) => batch.id === state.activePlanBatchId);
      state.planOptions = activeBatch?.plans?.map((option) => ({ ...option, plan: { ...option.plan } })) || [];
      renderPlanSuggestions();
      renderMemeLab();
      setStatus("已恢复草稿");
    } catch (error) {
      // A malformed legacy draft is ignored; valid project archives remain intact.
    }
  }

  function switchTab(tabName) {
    const workspaceGroups = {
      creation: ["script", "storyboard", "consistency", "creative"],
      planning: ["topics", "example"],
      world: ["bible", "characters", "assets"],
      operations: ["project", "history", "calendar", "optimize"],
    };
    const groupName = Object.entries(workspaceGroups).find(([, tabs]) => tabs.includes(tabName))?.[0] || "creation";
    $$(".workspace-group").forEach((button) => {
      const active = button.dataset.workspaceGroup === groupName;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $$("[data-workspace-tabs]").forEach((group) => group.classList.toggle("is-active", group.dataset.workspaceTabs === groupName));
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
      "## AI 视频段分镜",
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
        (shot) => [
          `#### 第 ${shot.shot} 段｜${shot.timeRange || `${shot.seconds || ""}秒`}`,
          `- 本段任务：${shot.segmentGoal || ""}`,
          `- 画面动作：${shot.visual || ""}；${shot.action || ""}`,
          `- 台词字幕：${shot.line || ""}；${shot.subtitle || ""}`,
          `- 承接入点：${shot.continuityIn || ""}`,
          `- 承接出点：${shot.continuityOut || ""}`,
          `- AI 视频提示词：${shot.visualPrompt || ""}`,
        ].join("\n"),
      )
      .join("\n");
    return [
      `## ${index + 1}. ${item.script?.title || "未命名剧本"}`,
      "",
      `- 时间：${item.createdAtText || item.createdAt || ""}`,
      `- 类型：${item.mode === "continue" ? "续写" : item.mode === "recast" ? "智能换角" : "新生成"}`,
      `- 模型：${item.model || ""}`,
      `- 状态：${item.pinned ? "入围" : "未入围"}`,
      "",
      "### 梗概",
      item.script?.synopsis || "",
      "",
      "### 结尾钩子",
      (item.script?.hooks || []).map((hook) => `- ${formatItem(hook)}`).join("\n"),
      "",
      "### AI 视频段分镜",
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
    document.addEventListener("click", (event) => {
      const modelButton = event.target.closest("[data-ai-model-value]");
      if (modelButton) setAiModel(modelButton.dataset.aiModelScope || "script", modelButton.dataset.aiModelValue);
    });
    $("#newProjectBtn").addEventListener("click", createProject);
    $("#saveProjectBtn").addEventListener("click", saveProjectMeta);
    $("#exportProjectBtn").addEventListener("click", exportCurrentProject);
    $("#importProjectBtn").addEventListener("click", () => $("#importProjectFile").click());
    $("#importProjectFile").addEventListener("change", (event) => {
      importProjectFile(event.target.files?.[0]);
      event.target.value = "";
    });
    $("#backupCloudNowBtn").addEventListener("click", async () => {
      try { await backupCloudNow(); } catch (error) { reportError("云端备份", error); }
    });
    $("#refreshCloudArchiveBtn").addEventListener("click", async () => {
      try { await refreshCloudArchive(true); } catch (error) { reportError("刷新恢复点", error); }
    });
    $("#copyWorkspaceKeyBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(archiveSync.workspaceKey());
        setStatus("恢复密钥已复制，请单独安全保存，不要公开分享");
      } catch (error) { reportError("复制恢复密钥", error); }
    });
    $("#connectWorkspaceKeyBtn").addEventListener("click", async () => {
      try {
        const key = $("#workspaceKeyInput").value.trim();
        const result = await archiveSync.connectWorkspaceKey(key);
        state.cloudArchive.versions = result.versions;
        $("#workspaceKeyInput").value = "";
        renderCloudArchive();
        setStatus("已连接恢复密钥，可以选择云端恢复点");
      } catch (error) { reportError("连接云端备份", error); }
    });
    $("#cloudArchiveVersions").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-cloud-restore]");
      if (!button) return;
      try { await restoreCloudArchive(Number(button.dataset.cloudRestore)); } catch (error) { reportError("恢复云端版本", error); }
    });
    $("#saveBibleBtn").addEventListener("click", saveBible);
    $("#addCanonSourceBtn").addEventListener("click", () => {
      try { addCanonSource(); } catch (error) { reportError("设定来源入库", error); }
    });
    $("#canonSourceLibrary").addEventListener("click", (event) => {
      const button = event.target.closest("[data-canon-source-delete]");
      if (button) deleteCanonSource(button.dataset.canonSourceDelete);
    });
    $("#memeLabBtn").addEventListener("click", async () => {
      try {
        await runMemeLab("extract");
      } catch (error) {
        reportError("热梗素材提炼", error);
      }
    });
    $("#memeInspireBtn").addEventListener("click", async () => {
      try {
        await runMemeLab("inspire");
      } catch (error) {
        reportError("梗结构生成", error);
      }
    });
    $("#memeLabResults").addEventListener("click", (event) => {
      const addButton = event.target.closest("[data-meme-idea-add]");
      const saveButton = event.target.closest("[data-meme-idea-save]");
      if (!addButton && !saveButton) return;
      try {
        if (addButton) adoptMemeIdea(Number(addButton.dataset.memeIdeaAdd));
        if (saveButton) saveMemeIdea(Number(saveButton.dataset.memeIdeaSave));
      } catch (error) {
        reportError(saveButton ? "收藏剧情梗" : "加入热梗素材", error);
      }
    });
    $("#addMemeBtn").addEventListener("click", () => {
      try { addManualMeme(); } catch (error) { reportError("梗库保存", error); }
    });
    ["memeLibrarySearch", "memeLibrarySource"].forEach((id) => document.getElementById(id)?.addEventListener(id === "memeLibrarySearch" ? "input" : "change", renderMemeLibrary));
    $("#memeLibrary").addEventListener("click", (event) => {
      const useButton = event.target.closest("[data-saved-meme-use]");
      const deleteButton = event.target.closest("[data-saved-meme-delete]");
      try {
        if (useButton) adoptSavedMeme(useButton.dataset.savedMemeUse);
        if (deleteButton) deleteSavedMeme(deleteButton.dataset.savedMemeDelete);
      } catch (error) { reportError("梗库操作", error); }
    });
    $("#applyBibleTemplateBtn").addEventListener("click", async () => {
      try {
        const label = $("#bibleTemplate").selectedOptions[0]?.textContent || "系列模板";
        await applyBibleDraft(bibleTemplate($("#bibleTemplate").value), `${label}模板`);
      } catch (error) {
        reportError("套用短剧圣经模板", error);
      }
    });
    $("#generateBibleBtn").addEventListener("click", async () => {
      try {
        await generateBibleDraft();
      } catch (error) {
        reportError("短剧圣经生成", error);
      }
    });
    $("#generateCharacterBtn").addEventListener("click", async () => {
      try { await generateCharacterDraft(); } catch (error) { reportError("角色卡生成", error); }
    });
    $("#saveCharacterBtn").addEventListener("click", () => {
      try { saveCharacterCard(); } catch (error) { reportError("角色卡保存", error); }
    });
    $("#clearCharacterBtn").addEventListener("click", clearCharacterDraft);
    $("#characterLibrary").addEventListener("click", (event) => {
      const useButton = event.target.closest("[data-character-use]");
      const editButton = event.target.closest("[data-character-edit]");
      const deleteButton = event.target.closest("[data-character-delete]");
      try {
        if (useButton) useCharacterCard(useButton.dataset.characterUse);
        if (editButton) {
          const card = (currentProject()?.characterCards || []).find((item) => item.id === editButton.dataset.characterEdit);
          if (!card) throw new Error("没有找到这个角色。");
          state.editingCharacterId = card.id;
          applyCharacterDraft(card);
          $("#characterName")?.focus();
        }
        if (deleteButton) deleteCharacterCard(deleteButton.dataset.characterDelete);
      } catch (error) { reportError("角色卡操作", error); }
    });
    $("#openAssetLibraryBtn").addEventListener("click", () => switchTab("assets"));
    $("#characterPicker").addEventListener("click", (event) => {
      const button = event.target.closest("[data-creative-character]");
      if (button) toggleCreativeCharacter(button.dataset.creativeCharacter);
    });
    $("#memePicker").addEventListener("click", (event) => {
      const button = event.target.closest("[data-creative-meme]");
      if (button) toggleCreativeMeme(button.dataset.creativeMeme);
    });
    $("#suggestCreativeMixBtn").addEventListener("click", async () => {
      try {
        await suggestCreativeMixes();
      } catch (error) {
        reportError("角色与梗搭配", error);
      }
    });
    $("#creativeMixResults").addEventListener("click", (event) => {
      const button = event.target.closest("[data-creative-mix-option]");
      if (!button) return;
      try {
        adoptCreativeMix(Number(button.dataset.creativeMixOption));
      } catch (error) {
        reportError("采用角色与梗搭配", error);
      }
    });
    $("#creativeMixHistoryList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-creative-mix-restore]");
      if (button) restoreCreativeMixBatch(button.dataset.creativeMixRestore);
    });
    $("#creativeMixBrief").addEventListener("input", () => {
      markBeatSheetStale();
      saveDraft(false);
    });
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
    $("#planHistoryList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-plan-batch-restore]");
      if (!button) return;
      try {
        restorePlanBatch(button.dataset.planBatchRestore);
      } catch (error) {
        reportError("恢复策划记录", error);
      }
    });
    ["planOpeningHook", "planConflict", "planProtagonistGoal", "planStakes", "planForcedChoice", "planReversal", "planRelationshipShift", "planEndingSuspense", "planTargetEmotion"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", () => {
        markBeatSheetStale();
        refreshCreationActions();
      });
    });
    $("#generateBeatSheetBtn").addEventListener("click", async () => {
      try {
        await generateBeatSheet();
      } catch (error) {
        reportError("剧情节拍表生成", error);
      }
    });
    $("#approveBeatSheetBtn").addEventListener("click", () => {
      try {
        approveBeatSheet();
      } catch (error) {
        reportError("确认节拍表", error);
      }
    });
    $("#beatSheetHistoryList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-beat-sheet-restore]");
      if (button) restoreBeatSheetBatch(button.dataset.beatSheetRestore);
    });
    $("#checkContinuityBtn").addEventListener("click", async () => {
      try {
        await runContinuityCheck();
      } catch (error) {
        reportError("一致性检查", error);
      }
    });
    $("#runScriptDoctorBtn").addEventListener("click", async () => {
      try { await runScriptDoctor(); } catch (error) { reportError("剧本医生", error); }
    });
    $("#applyDoctorRevisionBtn").addEventListener("click", () => {
      try { applyDoctorRevision(); } catch (error) { reportError("采用修订稿", error); }
    });
    $("#updateSeriesLedgerBtn").addEventListener("click", async () => {
      try { await updateSeriesLedger(); } catch (error) { reportError("连载台账", error); }
    });
    $("#ledgerHistoryList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-ledger-restore]");
      if (button) restoreLedgerVersion(Number(button.dataset.ledgerRestore));
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
      renderCharacterCards();
      renderMemeLibrary();
      renderCreativeAssetPicker();
      renderCreativeMixResults();
      renderCreativeMixHistory();
      renderBeatSheet();
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
    $("#storyboardTable").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-copy-storyboard-segment]");
      if (!button) return;
      try {
        await copyStoryboardSegment(Number(button.dataset.copyStoryboardSegment));
      } catch (error) {
        reportError("复制视频段", error);
      }
    });
    $("#storyboardHistory").addEventListener("click", (event) => {
      const button = event.target.closest("[data-storyboard-version]");
      if (!button) return;
      try {
        restoreStoryboardVersion(button.dataset.storyboardVersion);
      } catch (error) {
        reportError("恢复分镜版本", error);
      }
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
        if (generateButton) focusEpisodePlanning();
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
    $$(".workspace-group").forEach((button) => button.addEventListener("click", () => {
      const firstTab = $(`[data-workspace-tabs="${button.dataset.workspaceGroup}"] .tab`);
      if (firstTab) switchTab(firstTab.dataset.tab);
    }));
    $$(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
    $("#openRecastBtn").addEventListener("click", () => {
      try { openRecastPanel(); } catch (error) { reportError("智能换角", error); }
    });
    $("#closeRecastBtn").addEventListener("click", () => { $("#recastPanel").hidden = true; });
    $("#applyRecastBtn").addEventListener("click", async () => {
      try { await applyScriptRecast(); } catch (error) { reportError("智能换角", error); }
    });
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
    if (!window.RocoStudio || !window.RocoWorkflowCore || !window.RocoProjectDomain || !window.RocoEpisodePlanner || !window.RocoUiTemplates || !window.RocoApiClient || !window.RocoDataStore || !window.RocoArchiveSync || !window.RocoAppState || !window.RocoAiOperation || !window.RocoGenerationClient) {
      setStatus("生成器未加载，请用本地服务打开或刷新缓存", true);
      return;
    }
    try {
      bindEvents();
      await loadProjects();
      await restoreDraft();
      renderAiModelSwitches();
      renderMemeLab();
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
      renderCharacterCards();
      renderMemeLibrary();
      renderCreativeAssetPicker();
      renderCreativeMixResults();
      renderCreativeMixHistory();
      renderBeatSheet();
      renderAssets();
      renderConsistency();
      renderExample();
      renderCloudArchive();
      checkAiStatus();
      if (localStorage.getItem(accessCodeKey)) refreshCloudArchive(false).catch(() => {});
    } catch (error) {
      reportError("初始化", error);
    }
  }

  window.addEventListener("pagehide", () => archiveSync.dispose(), { once: true });

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("error", (event) => {
    reportError("脚本", event.error || event.message);
  });
  window.addEventListener("beforeunload", (event) => {
    if (persistedProjectRevision >= projectWriteRevision) return;
    event.preventDefault();
    event.returnValue = "";
  });
})();
