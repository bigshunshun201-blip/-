(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoUiTemplates = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatItem(item) {
    if (typeof item === "string") return item;
    if (item?.name && item.description) return `${item.name}：${item.description}`;
    if (item?.beat && item.content) return `${item.beat}：${item.content}`;
    if (item?.role && item.line) return `${item.id ? `${item.id} · ` : ""}${item.role}：“${item.line}”${item.intention ? `｜意图：${item.intention}` : ""}${item.subtext ? `｜潜台词：${item.subtext}` : ""}${item.beatIds?.length ? `｜${item.beatIds.join("、")}` : ""}`;
    return Object.values(item || {}).join("：");
  }

  function renderList(title, items = []) {
    return `
      <section class="content-block">
        <h3>${escapeHtml(title)}</h3>
        <ul>${items.map((item) => `<li>${escapeHtml(formatItem(item))}</li>`).join("")}</ul>
      </section>
    `;
  }

  function emptyStudio(input = {}) {
    const isContinuation = input.creationMode === "continue";
    const sourceTitle = input.continuationSourceRef?.title || "所选来源剧本";
    return `
      <section class="studio-empty">
        <div class="empty-hero">
          <img class="empty-hero-art" src="./assets/moonlit-wind-tower.png" alt="" aria-hidden="true" />
          <p class="eyebrow">月牙镇 · ${isContinuation ? "续写创作入口" : "本集创作入口"}</p>
          <h3>${isContinuation ? `先承接《${escapeHtml(sourceTitle)}》，再决定下一集怎么升级。` : "先搭角色与梗，再确认这集怎么演。"}</h3>
          <p>${isContinuation ? "来源剧本保持只读；确认承接卡、人物选择与 8 个剧情节拍后，再生成独立的下一集剧本。" : "选定本集角色和梗，确认人物选择与 8 个剧情节拍后，AI 才会写正式剧本。"}</p>
          <div class="empty-actions">
            <button class="primary-action compact-action" data-empty-generate="true">${isContinuation ? "开始续写策划" : "开始本集策划"}</button>
            <button class="ghost-action compact-action" data-empty-topics="true">查看选题库</button>
          </div>
        </div>
        <div class="input-brief">
          <div><span>主题</span><strong>${escapeHtml(input.theme || "未填写")}</strong></div>
          <div><span>场景</span><strong>${escapeHtml(input.scene || "未填写")}</strong></div>
          <div><span>受众</span><strong>${escapeHtml(input.audience || "未填写")}</strong></div>
          <div><span>时长</span><strong>${escapeHtml(input.duration || 60)} 秒</strong></div>
        </div>
        <div class="workflow-strip">
          <article><span>01</span><strong>搭角色与梗</strong><p>手动选择，或让 AI 从现有资产设计三套组合。</p></article>
          <article><span>02</span><strong>确定本集策划</strong><p>明确目标、代价、被迫选择、反转和关系变化。</p></article>
          <article><span>03</span><strong>确认剧情节拍</strong><p>先审 8 个因果节点，避免直接生成一篇完整故事。</p></article>
          <article><span>04</span><strong>生成剧本与分镜</strong><p>剧本满意后，再为同一版本生成对应视频段。</p></article>
        </div>
      </section>
    `;
  }

  function script(scriptValue) {
    const integrations = scriptValue.assetIntegration || {};
    const characterUses = (integrations.characters || []).map((item) => ({
      name: item.name,
      description: `${item.storyFunction}；关键选择：${item.choice}`,
    }));
    const memeUses = (integrations.memes || []).map((item) => ({
      name: `${item.name} · ${item.triggerRole}`,
      description: `铺垫：${item.setup}；回扣：${item.payoff}；推动剧情：${item.plotEffect}`,
    }));
    return `
      <section class="content-block">
        <h3>故事梗概</h3>
        <p>${escapeHtml(scriptValue.synopsis)}</p>
        <div class="tagline">${(scriptValue.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      </section>
      ${renderList("人物设定", scriptValue.characters || [])}
      ${renderList("剧情结构", scriptValue.structure || [])}
      ${renderList("台词", scriptValue.dialogue || [])}
      ${renderList("情绪节奏", scriptValue.rhythm || [])}
      ${renderList("反转点", scriptValue.reversals || [])}
      ${(scriptValue.innovationPoints || []).length ? renderList("创新机制", scriptValue.innovationPoints) : ""}
      ${(scriptValue.comedyBeats || []).length ? renderList("笑点设计", scriptValue.comedyBeats) : ""}
      ${(scriptValue.visualHighlights || []).length ? renderList("视觉爆点", scriptValue.visualHighlights) : ""}
      ${characterUses.length ? renderList("角色戏剧任务", characterUses) : ""}
      ${memeUses.length ? renderList("梗的铺垫与回扣", memeUses) : ""}
      ${renderList("爆点与结尾钩子", scriptValue.hooks || [])}
    `;
  }

  function scriptEditor(scriptValue, options = {}) {
    const script = scriptValue || {};
    const locked = new Set(options.lockedBeatIds || []);
    const instructionMap = options.rewriteInstructions || {};
    const listValue = (items) => (items || []).join("\n");
    return `
      <div class="script-editor-section script-editor-basics">
        <label>标题<input data-script-editor-input data-script-field="title" value="${escapeHtml(script.title || "")}" /></label>
        <label class="editor-wide">故事梗概<textarea data-script-editor-input data-script-field="synopsis" rows="5">${escapeHtml(script.synopsis || "")}</textarea></label>
      </div>
      <section class="script-editor-section">
        <div class="editor-section-head"><div><span>01</span><h3>人物设定</h3></div><button class="small-action" type="button" data-editor-add="characters">添加角色</button></div>
        <div class="editor-rows">${(script.characters || []).map((item, index) => `
          <div class="editor-row character-editor-row" data-editor-item="characters" data-editor-index="${index}">
            <input data-script-editor-input data-item-field="name" value="${escapeHtml(item.name)}" aria-label="角色名" />
            <textarea data-script-editor-input data-item-field="description" rows="3" aria-label="角色设定">${escapeHtml(item.description)}</textarea>
            <button class="storyboard-icon-button" type="button" data-editor-remove="characters" data-editor-index="${index}" aria-label="删除角色" title="删除角色">×</button>
          </div>`).join("")}</div>
      </section>
      <section class="script-editor-section">
        <div class="editor-section-head"><div><span>02</span><h3>剧情结构与局部改写</h3></div><small>锁定的节拍不会发送局部改写</small></div>
        <div class="structure-editor-list">${(script.structure || []).map((item, index) => {
          const beatIds = item.beatIds || [];
          const key = beatIds.join("+");
          const isLocked = beatIds.some((id) => locked.has(id));
          return `<article class="structure-editor-item ${isLocked ? "is-locked" : ""}" data-editor-item="structure" data-editor-index="${index}">
            <div class="structure-editor-head"><div><span>${escapeHtml(beatIds.join(" · "))}</span><input data-script-editor-input data-item-field="beat" value="${escapeHtml(item.beat)}" aria-label="结构名称" /></div><label class="lock-control"><input type="checkbox" data-beat-lock="${escapeHtml(key)}" ${isLocked ? "checked" : ""} />锁定</label></div>
            <textarea data-script-editor-input data-item-field="content" rows="5" aria-label="剧情内容">${escapeHtml(item.content)}</textarea>
            <div class="rewrite-command"><input data-rewrite-instruction="${escapeHtml(key)}" value="${escapeHtml(instructionMap[key] || "")}" placeholder="告诉 AI 这一拍具体要加强什么" ${isLocked ? "disabled" : ""}/><button class="secondary-action compact-action" type="button" data-rewrite-beats="${escapeHtml(key)}" ${isLocked ? "disabled" : ""}>AI 改写本拍与关联台词</button></div>
          </article>`;
        }).join("")}</div>
      </section>
      <section class="script-editor-section">
        <div class="editor-section-head"><div><span>03</span><h3>台词</h3></div><button class="small-action" type="button" data-editor-add="dialogue">添加台词</button></div>
        <div class="dialogue-editor-list">${(script.dialogue || []).map((item, index) => `
          <article class="dialogue-editor-item" data-editor-item="dialogue" data-editor-index="${index}">
            <div class="dialogue-editor-meta"><code>${escapeHtml(item.id)}</code><input data-script-editor-input data-item-field="beatIds" value="${escapeHtml((item.beatIds || []).join(","))}" aria-label="关联节拍" /><button class="storyboard-icon-button" type="button" data-editor-remove="dialogue" data-editor-index="${index}" aria-label="删除台词" title="删除台词">×</button></div>
            <div class="dialogue-editor-grid"><input data-script-editor-input data-item-field="role" value="${escapeHtml(item.role)}" aria-label="说话角色" /><textarea data-script-editor-input data-item-field="line" rows="2" aria-label="台词">${escapeHtml(item.line)}</textarea><input data-script-editor-input data-item-field="intention" value="${escapeHtml(item.intention || "")}" placeholder="台词意图" /><input data-script-editor-input data-item-field="subtext" value="${escapeHtml(item.subtext || "")}" placeholder="潜台词" /></div>
          </article>`).join("")}</div>
      </section>
      <section class="script-editor-section editor-text-lists">
        <div class="editor-section-head"><div><span>04</span><h3>节奏、反转与钩子</h3></div><small>每行一条</small></div>
        <label>情绪节奏<textarea data-script-editor-input data-script-list="rhythm" rows="3">${escapeHtml(listValue(script.rhythm))}</textarea></label>
        <label>反转点<textarea data-script-editor-input data-script-list="reversals" rows="3">${escapeHtml(listValue(script.reversals))}</textarea></label>
        <label>创新机制<textarea data-script-editor-input data-script-list="innovationPoints" rows="3">${escapeHtml(listValue(script.innovationPoints))}</textarea></label>
        <label>爆点与结尾钩子<textarea data-script-editor-input data-script-list="hooks" rows="3">${escapeHtml(listValue(script.hooks))}</textarea></label>
        <label>话题标签<textarea data-script-editor-input data-script-list="tags" rows="2">${escapeHtml(listValue(script.tags))}</textarea></label>
      </section>
      <section class="script-editor-section">
        <div class="editor-section-head"><div><span>05</span><h3>笑点设计</h3></div><button class="small-action" type="button" data-editor-add="comedyBeats">添加笑点</button></div>
        <div class="editor-rows">${(script.comedyBeats || []).map((item, index) => `<div class="editor-row triple-editor-row" data-editor-item="comedyBeats" data-editor-index="${index}"><textarea data-script-editor-input data-item-field="setup" rows="2" placeholder="铺垫">${escapeHtml(item.setup)}</textarea><textarea data-script-editor-input data-item-field="payoff" rows="2" placeholder="误导或回扣">${escapeHtml(item.payoff)}</textarea><textarea data-script-editor-input data-item-field="visualAction" rows="2" placeholder="静音可懂的动作">${escapeHtml(item.visualAction)}</textarea><button class="storyboard-icon-button" type="button" data-editor-remove="comedyBeats" data-editor-index="${index}" aria-label="删除笑点">×</button></div>`).join("")}</div>
      </section>
      <section class="script-editor-section">
        <div class="editor-section-head"><div><span>06</span><h3>视觉爆点</h3></div><button class="small-action" type="button" data-editor-add="visualHighlights">添加画面</button></div>
        <div class="editor-rows">${(script.visualHighlights || []).map((item, index) => `<div class="editor-row triple-editor-row" data-editor-item="visualHighlights" data-editor-index="${index}"><textarea data-script-editor-input data-item-field="moment" rows="2" placeholder="发生时刻">${escapeHtml(item.moment)}</textarea><textarea data-script-editor-input data-item-field="verticalComposition" rows="2" placeholder="9:16 构图">${escapeHtml(item.verticalComposition)}</textarea><textarea data-script-editor-input data-item-field="effect" rows="2" placeholder="画面效果">${escapeHtml(item.effect)}</textarea><button class="storyboard-icon-button" type="button" data-editor-remove="visualHighlights" data-editor-index="${index}" aria-label="删除画面">×</button></div>`).join("")}</div>
      </section>`;
  }

  function diffText(value) {
    if (value == null) return "无";
    if (typeof value === "string") return value;
    return formatItem(value) || JSON.stringify(value, null, 2);
  }

  function versionDiff(groups = []) {
    if (!groups.length) return `<p class="helper">两个版本没有结构化差异。</p>`;
    return groups.map((group) => `<section class="diff-group"><h3>${escapeHtml(group.label)}<span>${group.changes.length}</span></h3>${group.changes.map((change) => `<article class="diff-item is-${escapeHtml(change.type)}"><strong>${escapeHtml(change.key)}</strong><div class="diff-columns"><div><span>之前</span><p>${escapeHtml(diffText(change.before))}</p></div><div><span>之后</span><p>${escapeHtml(diffText(change.after))}</p></div></div></article>`).join("")}</section>`).join("");
  }

  function scriptVersions(versions = [], activeId = "") {
    if (!versions.length) return `<p class="helper">当前集数还没有剧本版本。</p>`;
    return versions.map((version, index) => {
      const reviewStatus = version.approvalReview?.status;
      const status = version.approvalStatus === "approved" ? (reviewStatus === "overridden" ? "风险批准" : reviewStatus === "legacy" ? "历史批准" : "已批准") : "草稿";
      return `<button class="script-version-row ${version.id === activeId ? "is-active-version" : ""}" type="button" data-script-version-restore="${escapeHtml(version.id)}"><span>v${index + 1}</span><div><strong>${escapeHtml(version.script?.title || "未命名剧本")}</strong><small>${escapeHtml(version.revisionNote || version.revisionSource || "生成版本")}</small></div><em data-status="${escapeHtml(reviewStatus || "draft")}">${escapeHtml(status)}</em></button>`;
    }).join("");
  }

  function table(rows = [], columns = []) {
    if (!rows.length) return `<p class="helper">暂无数据。</p>`;
    return `
      <table>
        <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    `;
  }

  function storyboard(storyboardRows = [], hasScript = false, activeIndex = 0, options = {}) {
    if (!storyboardRows.length) {
      return hasScript
        ? `<p class="helper">当前剧本版本还没有对应分镜。确认剧本方向可用后，点击“基于本版剧本生成 AI 视频段”。</p>`
        : `<p class="helper">请先生成或恢复一个剧本版本，再为它生成对应的 AI 视频段分镜。</p>`;
    }
    const selectedIndex = Math.max(0, Math.min(Number(activeIndex) || 0, storyboardRows.length - 1));
    const statusOptions = ["已有", "待制作", "待采集"];
    const beats = (items = []) => items.map((beat) => `<div class="segment-beat"><strong>${escapeHtml(beat.range)}</strong><span>${escapeHtml(beat.content)}</span></div>`).join("");
    const candidate = options.candidate || null;
    const input = (index, field, value, label) => `<label>${label}<input data-storyboard-edit-field="${field}" data-shot-index="${index}" value="${escapeHtml(value)}" /></label>`;
    const area = (index, field, value, label, rows = 3) => `<label>${label}<textarea data-storyboard-edit-field="${field}" data-shot-index="${index}" rows="${rows}">${escapeHtml(value)}</textarea></label>`;
    const candidateDiff = (changes = []) => changes.length ? changes.map((item) => `<article class="storyboard-candidate-change"><strong>${escapeHtml(item.label)}</strong><div><p><span>当前</span>${escapeHtml(Array.isArray(item.before) ? JSON.stringify(item.before) : item.before)}</p><p><span>候选</span>${escapeHtml(Array.isArray(item.after) ? JSON.stringify(item.after) : item.after)}</p></div></article>`).join("") : `<p class="helper">候选没有产生可见改动。</p>`;
    return `
      <div class="storyboard-review" data-storyboard-review>
        <nav class="storyboard-segment-rail" aria-label="分镜段落">
          <div class="storyboard-rail-head"><span>视频段</span><strong>${storyboardRows.length}</strong></div>
          <div class="storyboard-segment-index" role="tablist" aria-orientation="vertical">
            ${storyboardRows.map((shot, index) => `
              <button class="storyboard-segment-link ${index === selectedIndex ? "is-active" : ""}" type="button" role="tab" data-storyboard-jump="${index}" aria-selected="${index === selectedIndex}" aria-controls="storyboard-detail-${index}" tabindex="${index === selectedIndex ? "0" : "-1"}">
                <span class="storyboard-segment-number">${String(index + 1).padStart(2, "0")}</span>
                <span class="storyboard-segment-summary">
                  <strong>${escapeHtml(shot.clipId || `CLIP-${String(index + 1).padStart(2, "0")}`)}</strong>
                  <small>${escapeHtml(shot.timeRange)} · ${escapeHtml(shot.seconds)}秒</small>
                  <em>${escapeHtml(shot.segmentGoal || "未填写本段任务")}</em>
                </span>
              </button>`).join("")}
          </div>
        </nav>
        <section class="storyboard-reader" aria-label="当前分镜详情">
          <div class="storyboard-reader-toolbar">
            <div><strong data-storyboard-position>第 ${selectedIndex + 1} / ${storyboardRows.length} 段</strong><span>逐段审阅</span></div>
            <div class="storyboard-reader-actions">
              <button class="storyboard-icon-button" type="button" data-storyboard-step="-1" aria-label="上一段" title="上一段" ${selectedIndex === 0 ? "disabled" : ""}>←</button>
              <button class="segment-copy-button" type="button" data-copy-storyboard-segment="${selectedIndex}">复制本段</button>
              <button class="storyboard-icon-button" type="button" data-storyboard-step="1" aria-label="下一段" title="下一段" ${selectedIndex === storyboardRows.length - 1 ? "disabled" : ""}>→</button>
            </div>
          </div>
          ${storyboardRows.map((shot, index) => `
            <article class="storyboard-segment-detail" id="storyboard-detail-${index}" data-storyboard-detail="${index}" role="tabpanel" ${index === selectedIndex ? "" : "hidden"}>
              <header class="storyboard-detail-header">
                <div>
                  <div class="storyboard-detail-kicker"><span>${escapeHtml(shot.clipId || `CLIP-${String(index + 1).padStart(2, "0")}`)}</span><span>${escapeHtml(shot.timeRange)}</span></div>
                  <h3>${escapeHtml(shot.segmentGoal || "未填写本段任务")}</h3>
                  <p>${escapeHtml(shot.characters || "未填写角色")} · ${escapeHtml(shot.scene || "未填写场景")}</p>
                </div>
                <div class="storyboard-time-meta">
                  <span>成片 <strong>${escapeHtml(shot.seconds)}秒</strong></span>
                  <span>生成 <strong>${escapeHtml(shot.generationSeconds || shot.seconds)}秒</strong></span>
                  ${Number(shot.trimSeconds || 0) ? `<span>裁剪 <strong>${escapeHtml(shot.trimSeconds)}秒</strong></span>` : ""}
                </div>
              </header>
              <div class="storyboard-detail-grid">
                <section class="storyboard-detail-block">
                  <h4>段内节拍与动作</h4>
                  ${beats(shot.beatBreakdown)}
                  <p>${escapeHtml(shot.visual)}</p>
                  <p class="storyboard-action-line">${escapeHtml(shot.action)}</p>
                </section>
                <section class="storyboard-detail-block">
                  <h4>台词与字幕</h4>
                  <blockquote>${escapeHtml(shot.line || "本段无台词")}</blockquote>
                  <p class="storyboard-subtitle">字幕：${escapeHtml(shot.subtitle || shot.line || "无")}</p>
                  <div class="storyboard-id-row"><span>${escapeHtml((shot.beatIds || []).join("、") || "未关联节拍")}</span><span>${escapeHtml((shot.dialogueIds || []).join("、") || "未关联台词")}</span></div>
                </section>
                <section class="storyboard-detail-block">
                  <h4>镜头与声音</h4>
                  <dl class="storyboard-spec-list">
                    <div><dt>景别</dt><dd>${escapeHtml(shot.scale)}</dd></div>
                    <div><dt>运动</dt><dd>${escapeHtml(shot.movement)}</dd></div>
                    <div><dt>声音</dt><dd>${escapeHtml(shot.sound)}</dd></div>
                  </dl>
                </section>
                <section class="storyboard-detail-block">
                  <h4>首尾连续性</h4>
                  <div class="storyboard-continuity"><span>承接入点</span><p>${escapeHtml(shot.continuityIn)}</p></div>
                  <div class="storyboard-continuity is-out"><span>承接出点</span><p>${escapeHtml(shot.continuityOut)}</p></div>
                </section>
                <section class="storyboard-detail-block storyboard-prompt-block">
                  <h4>AI 视频提示词</h4>
                  <p>${escapeHtml(shot.visualPrompt)}</p>
                </section>
                <section class="storyboard-production-fields">
                  <label>关联资产<input data-shot-field="assetLinks" data-shot-index="${index}" value="${escapeHtml(shot.assetLinks)}" placeholder="资产库名称 / 待采集素材" /></label>
                  <label>制作备注<input data-shot-field="assetNote" data-shot-index="${index}" value="${escapeHtml(shot.assetNote)}" placeholder="负责人、截止时间或备注" /></label>
                  <label>素材状态<select data-shot-field="assetStatus" data-shot-index="${index}">${statusOptions.map((status) => `<option value="${status}" ${shot.assetStatus === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
                </section>
                <details class="storyboard-segment-editor" ${index === selectedIndex ? "open" : ""}>
                  <summary>精修本段全部制作字段</summary>
                  <div class="storyboard-editor-grid">
                    ${input(index, "segmentGoal", shot.segmentGoal, "本段任务")}
                    ${input(index, "characters", shot.characters, "角色")}
                    ${input(index, "scene", shot.scene, "场景")}
                    ${area(index, "beatBreakdown", (shot.beatBreakdown || []).map((item) => `${item.range}｜${item.content}`).join("\n"), "段内节拍（每行：时间｜动作）")}
                    ${area(index, "visual", shot.visual, "画面内容")}
                    ${area(index, "action", shot.action, "角色动作")}
                    ${area(index, "line", shot.line, "台词/旁白")}
                    ${area(index, "subtitle", shot.subtitle, "字幕")}
                    ${input(index, "scale", shot.scale, "景别")}
                    ${input(index, "movement", shot.movement, "镜头运动")}
                    ${input(index, "sound", shot.sound, "音效/配乐")}
                    ${area(index, "continuityIn", shot.continuityIn, "承接入点")}
                    ${area(index, "continuityOut", shot.continuityOut, "承接出点")}
                    ${area(index, "visualPrompt", shot.visualPrompt, "AI 视频提示词", 6)}
                    ${input(index, "beatIds", (shot.beatIds || []).join("、"), "关联节拍 ID")}
                    ${input(index, "dialogueIds", (shot.dialogueIds || []).join("、"), "关联台词 ID")}
                    ${input(index, "generationMode", shot.generationMode, "生成模式")}
                    ${input(index, "generationSeconds", shot.generationSeconds, "生成秒数")}
                    ${input(index, "trimSeconds", shot.trimSeconds, "裁剪秒数")}
                  </div>
                  <div class="storyboard-ai-rewrite">
                    <input data-storyboard-rewrite-instruction="${index}" value="${escapeHtml(options.instructionByClipId?.[shot.clipId] || "")}" placeholder="例如：动作更连贯，保留台词与首尾人物位置" />
                    <button class="secondary-action" type="button" data-storyboard-regenerate="${index}">AI 重生成本段</button>
                  </div>
                  ${candidate?.index === index ? `<section class="storyboard-segment-candidate"><div class="candidate-head"><div><p class="eyebrow">单段 AI 候选</p><h3>${escapeHtml(candidate.summary || "等待采用")}</h3></div><span>前后边界已锁定</span></div>${candidateDiff(candidate.changes)}<div class="candidate-actions"><button class="ghost-action" type="button" data-storyboard-candidate-discard>放弃候选</button><button class="secondary-action" type="button" data-storyboard-candidate-adopt>采用到分镜工作稿</button></div></section>` : ""}
                </details>
              </div>
            </article>`).join("")}
        </section>
      </div>`;
  }

  function historyMeta(item) {
    return [
      item.mode === "continue" ? "续写" : item.mode === "recast" ? "智能换角" : "新生成",
      item.model || "model",
      `${item.storyboard?.length || 0}个视频段`,
      `${item.input?.duration || "-"}秒`,
    ].filter(Boolean);
  }

  function history(items = []) {
    if (!items.length) return `<p class="helper">还没有生成记录。每次点击 AI 生成或 AI 续写后，结果都会自动保存在这里。</p>`;
    return items.map((item, index) => {
      const hooks = item.script?.hooks || [];
      return `
        <article class="history-card ${item.pinned ? "is-pinned" : ""}">
          <div class="history-card-main">
            <div>
              <div class="history-meta">
                <span>${escapeHtml(item.createdAtText || "")}</span>
                ${historyMeta(item).map((meta) => `<span>${escapeHtml(meta)}</span>`).join("")}
                ${item.pinned ? "<span>已入围</span>" : ""}
              </div>
              <h3>${escapeHtml(item.script?.title || "未命名剧本")}</h3>
              ${item.sourceRef ? `<p class="history-lineage">续写自第 ${escapeHtml(item.sourceRef.episodeNumber)} 集 v${escapeHtml(item.sourceRef.versionNumber || 1)} · ${escapeHtml(item.sourceRef.title || "来源剧本")}</p>` : ""}
              <p>${escapeHtml(item.script?.synopsis || "")}</p>
              <div class="tagline">${(item.script?.tags || []).slice(0, 5).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
            </div>
            <div class="history-actions">
              <button class="small-action" data-history-restore="${index}">查看/恢复</button>
              <button class="small-action" data-history-continue="${index}">基于它续写</button>
              <button class="small-action" data-history-pin="${index}">${item.pinned ? "取消入围" : "标记入围"}</button>
              <button class="small-action danger-action" data-history-delete="${index}">删除</button>
            </div>
          </div>
          ${hooks.length ? `<div class="history-hooks">${hooks.slice(0, 3).map((hook) => `<span>${escapeHtml(formatItem(hook))}</span>`).join("")}</div>` : ""}
        </article>
      `;
    }).join("");
  }

  return { escapeHtml, formatItem, renderList, emptyStudio, script, scriptEditor, versionDiff, scriptVersions, table, storyboard, history };
});
