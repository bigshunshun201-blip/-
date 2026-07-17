(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoQuickModeUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function icon(name, size = 18) {
    return `<i data-lucide="${escapeHtml(name)}" width="${size}" height="${size}" aria-hidden="true"></i>`;
  }

  function lines(value) {
    return (Array.isArray(value) ? value : [value]).map((item) => String(item || "").trim()).filter(Boolean);
  }

  function list(items, empty = "尚未填写") {
    const values = lines(items);
    return values.length ? `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="quick-empty-copy">${escapeHtml(empty)}</p>`;
  }

  function renderSteps(view) {
    return view.steps.map((step) => `
      <button class="quick-rail-step" type="button" data-quick-step="${step.id}" data-state="${step.state}" aria-current="${step.current ? "step" : "false"}" aria-label="${escapeHtml(`${step.label}${step.available ? "" : "，尚未解锁"}`)}">
        <span class="quick-step-marker">${step.complete ? icon("check", 15) : step.index + 1}</span>
        <span class="quick-step-copy"><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.verb)}</small><em>${escapeHtml(step.assetLabel)}</em></span>
        ${step.available ? icon("chevron-right", 16) : icon("lock-keyhole", 14)}
      </button>
    `).join("");
  }

  function renderIdea(view) {
    const input = view.input || {};
    const source = view.continuationSource;
    return `
      <div class="quick-stage-intro">
        <p class="quick-stage-kicker">第 1 步 · 开题</p>
        <h2>先说这集想讲什么</h2>
        <p>一句话就够。人物、场景和梗都可以稍后补充。</p>
      </div>
      <div class="quick-mode-choice" role="group" aria-label="创作方式">
        <button type="button" data-quick-creation-mode="new" class="${view.creationMode === "new" ? "is-active" : ""}">${icon("file-plus-2")}新建本集</button>
        <button type="button" data-quick-creation-mode="continue" class="${view.creationMode === "continue" ? "is-active" : ""}">${icon("git-branch")}续写下一集</button>
      </div>
      ${view.creationMode === "continue" ? `<section class="quick-source-strip">
        <div>${icon("link-2")}<span><small>续写来源</small><strong>${escapeHtml(source?.label || "还没有选择来源版本")}</strong></span></div>
        <p>${escapeHtml(source?.hook || "选择来源后，系统会先承接上一集结尾钩子。")}</p>
        <button type="button" data-quick-drawer="continuation">${source ? "调整承接" : "选择来源"}</button>
      </section>` : ""}
      <label class="quick-idea-field">
        <span>这一集，我想拍……</span>
        <textarea id="quickIdeaInput" data-quick-field="theme" rows="5" maxlength="240" placeholder="例如：雪影娃娃突然开了一家冷脸培训班，所有学员笑一下就会被冰冻。">${escapeHtml(input.theme)}</textarea>
        <small>写清楚一个反常事件或人物困境，AI 会补成三个不同方向。</small>
      </label>
      <div class="quick-brief-summary" aria-label="当前创作条件">
        <span>${icon("map-pin", 15)}${escapeHtml(input.scene || "场景待定")}</span>
        <span>${icon("timer", 15)}${escapeHtml(input.duration || 60)} 秒</span>
        <span>${icon("clapperboard", 15)}${escapeHtml(input.style || "风格待定")}</span>
        <span>${icon("users", 15)}${escapeHtml(view.roleSummary || "角色待定")}</span>
      </div>
      <div class="quick-secondary-row">
        <button type="button" data-quick-drawer="brief">${icon("sliders-horizontal")}补充场景、角色与风格</button>
        <button type="button" data-quick-drawer="assets">${icon("library")}添加角色和梗 <b>${view.selectedAssetCount || 0}</b></button>
        <button type="button" data-quick-drawer="topics">${icon("sparkles")}从选题库找灵感</button>
      </div>
    `;
  }

  function scoreBadge(option) {
    if (!option?.quality) return `<span class="quick-quality-badge is-muted">未评分</span>`;
    const duplicate = option.quality.duplicateLevel;
    return `<span class="quick-quality-badge" data-duplicate="${escapeHtml(duplicate)}"><strong>${escapeHtml(option.quality.total)}</strong>/100 · ${duplicate === "high" ? "高度重复" : duplicate === "similar" ? "存在相似" : "历史去重通过"}</span>`;
  }

  function renderPlanCard(option, index, selectedId) {
    const plan = option.plan || {};
    const selected = option.id === selectedId;
    return `<article class="quick-plan-card ${selected ? "is-selected" : ""}">
      <header><span>${escapeHtml(option.angle || `方向 ${index + 1}`)}</span>${scoreBadge(option)}</header>
      <h3>${escapeHtml(option.title)}</h3>
      <p>${escapeHtml(option.why || option.innovation || "")}</p>
      <dl>
        <div><dt>开头钩子</dt><dd>${escapeHtml(plan.openingHook)}</dd></div>
        <div><dt>核心冲突</dt><dd>${escapeHtml(plan.conflict)}</dd></div>
        <div><dt>反转</dt><dd>${escapeHtml(plan.reversal)}</dd></div>
        <div><dt>核心画面</dt><dd>${escapeHtml(option.visualSetpiece || plan.forcedChoice || "待展开")}</dd></div>
      </dl>
      <button type="button" data-quick-plan-adopt="${index}" ${selected ? "aria-pressed=\"true\"" : ""}>${selected ? `${icon("check")}已采用这套` : "采用这套"}</button>
    </article>`;
  }

  function renderPackage(view) {
    const pkg = view.creationPackage;
    if (!pkg) return view.selectedPlanId ? `<section class="quick-prep-empty">${icon("package-open", 28)}<div><strong>策划已经选好</strong><p>下一步会一次生成 8 段剧情节拍和七项本次创作圣经。</p></div></section>` : "";
    const bibleLabels = {
      characters: "角色设定", abilities: "能力边界", relations: "角色关系", antagonist: "反派与动机",
      worldRules: "世界规则", mainConflict: "主线矛盾", hookRules: "钩子规则",
    };
    const tab = view.packageTab === "bible" ? "bible" : "beats";
    return `<section class="quick-package">
      <header><div><span>创作准备包</span><strong>${escapeHtml(pkg.summary || "节拍与本次圣经已经生成")}</strong></div><em data-status="${escapeHtml(pkg.status)}">${pkg.status === "confirmed" ? "已确认" : pkg.status === "stale" ? "内容已过期" : "待检查"}</em></header>
      ${pkg.risks?.length ? `<div class="quick-risk-note">${icon("triangle-alert")}<span>${escapeHtml(pkg.risks.join("；"))}</span></div>` : ""}
      <div class="quick-package-tabs" role="tablist">
        <button type="button" data-quick-package-tab="beats" class="${tab === "beats" ? "is-active" : ""}">8 段节拍</button>
        <button type="button" data-quick-package-tab="bible" class="${tab === "bible" ? "is-active" : ""}">本次圣经</button>
      </div>
      <div class="quick-package-pane">
        ${tab === "beats" ? `<div class="quick-beat-list">${(pkg.beats || []).map((beat, index) => `<article>
          <span>${escapeHtml(beat.timeRange || `节拍 ${index + 1}`)}</span>
          <label>本拍行动<textarea rows="2" data-quick-beat-index="${index}" data-quick-beat-field="action">${escapeHtml(beat.action)}</textarea></label>
          <p><b>戏剧任务：</b>${escapeHtml(beat.dramaticTask)}</p><p><b>因果承接：</b>${escapeHtml(beat.causalLink)}</p>
        </article>`).join("")}</div>` : `<div class="quick-bible-grid">${Object.entries(bibleLabels).map(([field, label]) => `<label><span>${label}</span><textarea rows="4" data-quick-bible-field="${field}">${escapeHtml(pkg.bible?.[field])}</textarea></label>`).join("")}</div>`}
      </div>
    </section>`;
  }

  function renderPlan(view) {
    return `
      <div class="quick-stage-intro"><p class="quick-stage-kicker">第 2 步 · 策划</p><h2>${view.plans.length ? "选一套真正想拍的结构" : "先生成三个不同方向"}</h2><p>${view.plans.length ? "三案必须在冲突、反转和画面上明显不同。选择后仍可编辑。" : "回到创意页补充一句话想法，然后生成三案。"}</p></div>
      ${view.plans.length ? `<div class="quick-plan-grid">${view.plans.map((option, index) => renderPlanCard(option, index, view.selectedPlanId)).join("")}</div>` : `<div class="quick-guided-empty">${icon("route", 30)}<strong>还没有策划候选</strong><p>完成开题后，这里会并排展示三个可比较的剧情方向。</p></div>`}
      ${renderPackage(view)}
    `;
  }

  function renderScriptBody(script) {
    if (!script) return "";
    return `<article class="quick-script-paper">
      <header><p>${escapeHtml(script.synopsis)}</p></header>
      <section><h3>人物</h3>${(script.characters || []).map((item) => `<p><strong>${escapeHtml(item.name)}</strong>${escapeHtml(item.description)}</p>`).join("")}</section>
      <section><h3>剧情节拍</h3>${(script.structure || []).map((item, index) => `<article><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.beat || item.title || "剧情节点")}</strong><p>${escapeHtml(item.content)}</p>${(script.dialogue || []).filter((line) => (line.beatIds || []).some((id) => (item.beatIds || []).includes(id))).map((line) => `<blockquote><b>${escapeHtml(line.role)}</b>${escapeHtml(line.line)}</blockquote>`).join("")}</div></article>`).join("")}</section>
      <section class="quick-script-notes"><div><h3>反转</h3>${list(script.reversals)}</div><div><h3>结尾钩子</h3>${list(script.hooks)}</div></section>
    </article>`;
  }

  function renderScript(view) {
    if (!view.script) return `<div class="quick-stage-intro"><p class="quick-stage-kicker">第 3 步 · 剧本</p><h2>${view.packageConfirmed ? "准备包已就绪，可以生成剧本" : "剧本生成尚未解锁"}</h2><p>${view.packageConfirmed ? "AI 会固定引用已确认的节拍与本次圣经。" : "先完成策划、节拍和本次圣经，避免生成一篇与设定脱节的完整故事。"}</p></div>
      <div class="quick-requirement-board">${(view.stepState?.missing || []).map((item) => `<span>${icon("circle-dashed", 16)}${escapeHtml(item)}</span>`).join("")}</div>`;
    return `<div class="quick-stage-intro quick-script-heading"><div><p class="quick-stage-kicker">第 3 步 · 剧本</p><h2>${escapeHtml(view.script.title)}</h2><p>${escapeHtml(view.scriptMeta)}</p></div><span data-approval="${view.scriptApproved ? "approved" : "draft"}">${view.scriptApproved ? "已批准" : "草稿"}</span></div>${renderScriptBody(view.script)}`;
  }

  function renderQuickEditor(view) {
    const session = view.revision || {};
    const script = session.workingScript || view.script;
    if (!script) return "";
    return `<div class="quick-editor-layout">
      <section class="quick-editor-main">
        <label>标题<input data-script-editor-input data-script-field="title" value="${escapeHtml(script.title)}"></label>
        <label>故事梗概<textarea data-script-editor-input data-script-field="synopsis" rows="5">${escapeHtml(script.synopsis)}</textarea></label>
        <div class="quick-editor-section"><h3>剧情节拍</h3>${(script.structure || []).map((item, index) => {
          const beatKey = (item.beatIds || []).join("+") || `STRUCTURE-${index + 1}`;
          const locked = (session.lockedBeatIds || []).some((id) => (item.beatIds || []).includes(id));
          return `<article data-editor-item="structure" data-editor-index="${index}"><header><strong>${escapeHtml(item.beat || `节拍 ${index + 1}`)}</strong><label class="quick-lock"><input type="checkbox" data-quick-beat-lock="${escapeHtml(beatKey)}" ${locked ? "checked" : ""}>锁定</label></header><textarea data-script-editor-input data-item-field="content" rows="4">${escapeHtml(item.content)}</textarea><div class="quick-rewrite-line"><input data-quick-rewrite-instruction="${escapeHtml(beatKey)}" value="${escapeHtml(session.rewriteInstructions?.[beatKey] || "")}" placeholder="只说明这一拍要怎么改"><button type="button" data-quick-rewrite-beats="${escapeHtml(beatKey)}">${icon("wand-sparkles", 15)}AI 改这一拍</button></div></article>`;
        }).join("")}</div>
        <div class="quick-editor-section"><h3>台词</h3>${(script.dialogue || []).map((line, index) => `<article data-editor-item data-editor-item="dialogue" data-editor-index="${index}"><strong>${escapeHtml(line.role)} · ${escapeHtml(line.id)}</strong><textarea data-script-editor-input data-item-field="line" rows="2">${escapeHtml(line.line)}</textarea></article>`).join("")}</div>
      </section>
      <aside class="quick-editor-inspector">
        <h3>本版状态</h3><p>${session.dirty ? "工作稿有未保存修改。保存后才会形成正式版本。" : view.scriptApproved ? "当前版本已通过圣经复核。" : "当前版本等待圣经复核与批准。"}</p>
        <label>修改说明<textarea data-quick-revision-note rows="3" placeholder="例如：加强前 3 秒异常画面">${escapeHtml(session.revisionNote || "")}</textarea></label>
        ${session.rewriteCandidate ? `<section class="quick-candidate"><strong>AI 改写候选</strong><p>${escapeHtml(session.rewriteCandidate.changeSummary || "局部改写已完成")}</p><div>${view.candidateDiffHtml || ""}</div><button type="button" data-quick-adopt-candidate>采用候选</button><button type="button" data-quick-discard-candidate>放弃</button></section>` : ""}
        ${view.workingDiffHtml ? `<section class="quick-diff"><strong>基础版本 → 工作稿</strong>${view.workingDiffHtml}</section>` : ""}
        ${view.canonReviewHtml ? `<section class="quick-canon-review"><strong>圣经复核</strong>${view.canonReviewHtml}</section>` : ""}
      </aside>
    </div>`;
  }

  function renderVersions(view) {
    const versions = view.versions || [];
    return `<div class="quick-version-list">${versions.map((version) => `<article class="${version.active ? "is-active" : ""}"><div><span>v${version.number}</span><strong>${escapeHtml(version.title)}</strong><small>${escapeHtml(version.meta)}</small></div><em>${escapeHtml(version.status)}</em><button type="button" data-quick-version-restore="${escapeHtml(version.id)}" ${version.active ? "disabled" : ""}>打开此版本</button></article>`).join("") || `<p class="quick-empty-copy">还没有剧本版本。</p>`}</div>${view.compareOptions?.length ? `<section class="quick-version-diff"><header><h3>版本变化</h3><div><select aria-label="对比版本 A" data-quick-compare="left">${view.compareOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === view.compareLeftId ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select><span>对比</span><select aria-label="对比版本 B" data-quick-compare="right">${view.compareOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === view.compareRightId ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></div></header>${view.versionDiffHtml || `<p class="quick-empty-copy">两个版本没有可见差异。</p>`}</section>` : ""}`;
  }

  function renderRefine(view) {
    const activeView = view.revision?.activeView || "read";
    return `<div class="quick-stage-intro quick-refine-head"><div><p class="quick-stage-kicker">第 4 步 · 精修</p><h2>${escapeHtml(view.script?.title || "等待剧本")}</h2><p>只修改需要改的部分；保存、复核和批准会依次出现在底部主按钮。</p></div><div class="quick-view-tabs" role="tablist"><button data-quick-script-view="read" class="${activeView === "read" ? "is-active" : ""}">阅读</button><button data-quick-script-view="edit" class="${activeView === "edit" ? "is-active" : ""}">精修</button><button data-quick-script-view="versions" class="${activeView === "versions" ? "is-active" : ""}">版本</button></div></div>
      ${!view.script ? `<div class="quick-guided-empty">${icon("file-warning", 30)}<strong>先生成剧本</strong></div>` : activeView === "edit" ? renderQuickEditor(view) : activeView === "versions" ? renderVersions(view) : renderScriptBody(view.script)}`;
  }

  function renderStoryboard(view) {
    if (!view.storyboard.length) return `<div class="quick-stage-intro"><p class="quick-stage-kicker">第 5 步 · 分镜</p><h2>${view.scriptApproved ? "剧本已批准，可以生成分镜" : "分镜生成尚未解锁"}</h2><p>分镜只绑定当前批准版本，不会误用工作稿或上一集剧本。</p></div><div class="quick-requirement-board">${(view.stepState?.missing || []).map((item) => `<span>${icon("circle-dashed", 16)}${escapeHtml(item)}</span>`).join("")}</div>`;
    const active = view.storyboard[view.activeStoryboardIndex] || view.storyboard[0];
    return `<div class="quick-stage-intro"><p class="quick-stage-kicker">第 5 步 · 分镜</p><h2>${escapeHtml(view.script?.title || "当前剧本")} · ${view.storyboard.length} 个视频段</h2><p>每段保留剧本节拍与台词引用，便于生成视频后继续剪辑。</p></div>
      <div class="quick-storyboard-layout"><nav>${view.storyboard.map((segment, index) => `<button type="button" data-quick-storyboard-index="${index}" class="${index === view.activeStoryboardIndex ? "is-active" : ""}><span>${escapeHtml(segment.clipId || `段 ${index + 1}`)}</span><strong>${escapeHtml(segment.segmentGoal || segment.subtitle || "待补任务")}</strong><small>${escapeHtml(segment.seconds || 0)} 秒 · ${escapeHtml(segment.assetStatus || "待制作")}</small></button>`).join("")}</nav><article class="quick-storyboard-detail">
        <header><div><span>${escapeHtml(active.timeRange || `${active.seconds || 0} 秒`)}</span><h3>${escapeHtml(active.segmentGoal || "当前视频段")}</h3></div><em>${escapeHtml(active.assetStatus || "待制作")}</em></header>
        <dl><div><dt>角色与场景</dt><dd>${escapeHtml(active.characters)} · ${escapeHtml(active.scene)}</dd></div><div><dt>画面与动作</dt><dd>${escapeHtml(active.visual)}；${escapeHtml(active.action)}</dd></div><div><dt>台词 / 字幕</dt><dd>${escapeHtml(active.line)}<br>${escapeHtml(active.subtitle)}</dd></div><div><dt>景别与运动</dt><dd>${escapeHtml(active.scale)}；${escapeHtml(active.movement)}</dd></div><div><dt>连续性</dt><dd>入：${escapeHtml(active.continuityIn)}<br>出：${escapeHtml(active.continuityOut)}</dd></div></dl>
        <section><h4>AI 视频提示词</h4><p>${escapeHtml(active.visualPrompt || "尚未生成")}</p></section><section><h4>ChatGPT 图片提示词</h4><p>${escapeHtml(active.imagePrompt || "尚未生成")}</p></section>
        <div class="quick-segment-rewrite"><input data-quick-storyboard-rewrite-instruction="${view.activeStoryboardIndex}" value="${escapeHtml(view.storyboardRevision?.instructionByClipId?.[active.clipId] || "")}" placeholder="例如：把前 3 秒改成徽章突然裂开，保留人物站位"><button type="button" data-quick-regenerate-segment="${view.activeStoryboardIndex}">${icon("refresh-cw", 15)}AI 重生成本段</button></div>
        ${view.storyboardRevision?.candidate?.index === view.activeStoryboardIndex ? `<section class="quick-segment-candidate"><strong>${escapeHtml(view.storyboardRevision.candidate.summary || "单段改写候选")}</strong><p>${escapeHtml((view.storyboardRevision.candidate.changes || []).map((item) => item.field || item).join("、"))}</p><button type="button" data-quick-adopt-segment-candidate>采用候选</button><button type="button" data-quick-discard-segment-candidate>放弃</button></section>` : ""}
        <div class="quick-segment-actions"><button type="button" data-quick-copy-segment="${view.activeStoryboardIndex}">${icon("copy", 15)}复制本段</button><button type="button" data-quick-generate-image-prompt="${view.activeStoryboardIndex}">${icon("image-plus", 15)}${active.imagePrompt ? "重新生成图片提示词" : "生成图片提示词"}</button>${active.imagePrompt ? `<button type="button" data-quick-copy-image-prompt="${view.activeStoryboardIndex}">${icon("clipboard", 15)}复制图片提示词</button>` : ""}</div>
      </article></div>`;
  }

  function reviewField(id, label, value, options = {}) {
    const type = options.type || "number";
    return `<label>${label}<input type="${type}" data-quick-review-field="${id}" value="${escapeHtml(value ?? "")}" ${type === "number" ? "min=\"0\"" : ""}></label>`;
  }

  function renderReview(view) {
    const review = view.review || {};
    return `<div class="quick-stage-intro"><p class="quick-stage-kicker">第 6 步 · 发布复盘</p><h2>用真实数据决定下一集怎么改</h2><p>先填播放、完播和转粉，其他指标可以稍后补充。</p></div>
      <div class="quick-review-layout"><section><h3>核心数据</h3><div class="quick-review-grid">${reviewField("reviewViews", "播放量", review.views)}${reviewField("reviewCompletionRate", "完播率 %", review.completionRate)}${reviewField("reviewFollows", "新增关注", review.follows)}${reviewField("reviewLikes", "点赞", review.likes)}${reviewField("reviewComments", "评论", review.comments)}${reviewField("reviewShares", "转发", review.shares)}</div><label>用户反复在说什么<textarea data-quick-review-field="reviewCommentThemes" rows="5" placeholder="每行一个高频反馈">${escapeHtml(review.commentThemes)}</textarea></label><details><summary>补充高级指标</summary><div class="quick-review-grid">${reviewField("reviewFavorites", "收藏", review.favorites)}${reviewField("reviewAverageWatchTime", "平均观看时长", review.averageWatchTime)}${reviewField("reviewEarlyRetention", "前段留存 %", review.earlyRetention)}${reviewField("reviewPublishDate", "发布日期", review.publishDate, { type: "date" })}${reviewField("reviewPublishTime", "发布时间", review.publishTime, { type: "time" })}</div><label>制作备注<textarea data-quick-review-field="reviewNotes" rows="4">${escapeHtml(review.notes)}</textarea></label></details></section><aside><h3>下一集方向</h3>${view.reviewInsights?.length ? view.reviewInsights.map((item) => `<article><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.value)}</p></article>`).join("") : `<p class="quick-empty-copy">保存发布数据后，这里会给出下一集钩子、标题和封面方向。</p>`}${view.learning ? `<footer><strong>${view.learning.sampleCount} 个有效样本</strong><span>权重学习置信度 ${Math.round((view.learning.confidence || 0) * 100)}%</span></footer>` : ""}</aside></div>`;
  }

  function renderStage(view) {
    const renderers = { idea: renderIdea, plan: renderPlan, script: renderScript, refine: renderRefine, storyboard: renderStoryboard, review: renderReview };
    return (renderers[view.step] || renderIdea)(view);
  }

  function renderDrawer(type, view) {
    const input = view.input || {};
    if (type === "brief") return { title: "补充创作条件", eyebrow: "可选信息", body: `<div class="quick-drawer-form"><label>出场角色<textarea data-quick-field="roles" rows="5">${escapeHtml(input.roles)}</textarea></label>${["scene", "direction", "audience", "duration", "style"].map((field) => `<label>${escapeHtml(view.fieldLabels[field])}<select data-quick-field="${field}">${(view.fieldOptions[field] || []).map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(input[field]) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select><input ${field === "duration" ? "type=\"number\" min=\"15\" max=\"180\"" : "type=\"text\""} data-quick-custom-field="${field}" value="${escapeHtml(input.customValues?.[field] || "")}" placeholder="自定义${escapeHtml(view.fieldLabels[field])}"></label>`).join("")}<label>热榜与评论素材<textarea data-quick-field="memeSeed" rows="6">${escapeHtml(input.memeSeed)}</textarea></label><details><summary>高级设置</summary><div class="quick-drawer-advanced"><label>当前集数<input type="number" min="1" max="999" data-quick-field="episodeNumber" value="${escapeHtml(input.episodeNumber)}"></label><label>计划集数<input type="number" min="1" max="12" data-quick-field="episodeCount" value="${escapeHtml(input.episodeCount)}"></label><label>AI 视频分段<select data-quick-field="clipMode">${(view.fieldOptions.clipMode || []).map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(input.clipMode) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label></div></details></div>` };
    if (type === "assets") return { title: "本集角色和梗", eyebrow: "不是白名单，AI 仍可增加临时人物", body: `<div class="quick-asset-drawer"><section><h3>角色库</h3>${view.characters.length ? view.characters.map((item) => `<button type="button" data-quick-character-use="${escapeHtml(item.id)}" class="${item.selected ? "is-selected" : ""}"><span>${icon(item.selected ? "check" : "user-round-plus")}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.role || item.traits)}</small></div></button>`).join("") : `<p class="quick-empty-copy">角色库还没有人物，可以直接在创意中输入临时角色。</p>`}</section><section><h3>喜剧机制库</h3>${view.memes.length ? view.memes.map((item) => `<button type="button" data-quick-meme-use="${escapeHtml(item.id)}" class="${item.selected ? "is-selected" : ""}"><span>${icon(item.selected ? "check" : "plus")}</span><div><strong>${escapeHtml(item.phrase)}</strong><small>${escapeHtml(item.mechanismType || item.mechanism || "待补全机制")}</small></div></button>`).join("") : `<p class="quick-empty-copy">梗库为空。仍可把热榜文案直接粘贴到创作条件中。</p>`}</section></div>` };
    if (type === "topics") return { title: "从选题库找灵感", eyebrow: "选择只会填入创意，不会直接生成剧本", body: `<div class="quick-topic-drawer">${view.topics.map((item, index) => `<article><span>${escapeHtml(item.priority || "A")}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.sellingPoint)}</p><small>${escapeHtml(item.emotion)} · ${escapeHtml(item.duration)} 秒</small><button type="button" data-quick-topic-select="${index}">用这个方向开题</button></article>`).join("") || `<p class="quick-empty-copy">当前没有选题。可以先关闭抽屉并直接输入一句话想法。</p>`}</div>` };
    if (type === "continuation") return { title: "续写来源与承接", eyebrow: "只影响续写工作区", body: `<div class="quick-drawer-form"><label>来源剧本版本<select data-quick-continuation-source>${view.continuationCatalog.map((item) => `<option value="${escapeHtml(item.key)}" ${item.selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>${[["requiredHook", "必须承接的结尾钩子"], ["openQuestions", "尚未解决的问题"], ["characterState", "人物与关系现状"], ["constraints", "能力、道具与代价状态"], ["mustPreserve", "必须保留的事实"], ["direction", "本集推进方向"], ["newIdeas", "可选的新创意"]].map(([field, label]) => `<label>${label}<textarea data-quick-continuation-field="${field}" rows="3">${escapeHtml(view.continuationBrief?.[field])}</textarea></label>`).join("")}</div>` };
    return { title: "", eyebrow: "", body: "" };
  }

  return { escapeHtml, icon, renderSteps, renderStage, renderDrawer };
});
