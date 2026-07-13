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
    if (item?.role && item.line) return `${item.role}：“${item.line}”`;
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
    return `
      <section class="studio-empty">
        <div class="empty-hero">
          <img class="empty-hero-art" src="./assets/moonlit-wind-tower.png" alt="" aria-hidden="true" />
          <p class="eyebrow">月牙镇 · 本集创作入口</p>
          <h3>先生成剧本，满意后再拆分镜。</h3>
          <p>当前主题会进入剧本生成；选题库和热梗素材会辅助标题、冲突和台词方向。</p>
          <div class="empty-actions">
            <button class="primary-action compact-action" data-empty-generate="true">AI 生成剧本</button>
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
          <article><span>01</span><strong>生成剧本</strong><p>标题、梗概、人物、结构、台词和结尾钩子。</p></article>
          <article><span>02</span><strong>拆分镜</strong><p>确认剧本可用后，再基于同一版剧本生成镜头表。</p></article>
          <article><span>03</span><strong>筛候选</strong><p>生成记录会留档，方便入围、恢复和导出。</p></article>
        </div>
      </section>
    `;
  }

  function script(scriptValue) {
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
      ${renderList("爆点与结尾钩子", scriptValue.hooks || [])}
    `;
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

  function storyboard(storyboardRows = [], hasScript = false) {
    if (!storyboardRows.length) {
      return hasScript
        ? `<p class="helper">当前剧本版本还没有对应分镜。确认剧本方向可用后，点击“基于本版剧本生成 AI 视频段”。</p>`
        : `<p class="helper">请先生成或恢复一个剧本版本，再为它生成对应的 AI 视频段分镜。</p>`;
    }
    const statusOptions = ["已有", "待制作", "待采集"];
    const beats = (items = []) => items.map((beat) => `<div class="segment-beat"><strong>${escapeHtml(beat.range)}</strong><span>${escapeHtml(beat.content)}</span></div>`).join("");
    return `
      <table class="storyboard-production-table">
        <thead><tr><th>视频段</th><th>本段任务</th><th>角色 / 场景</th><th>段内节拍与动作</th><th>台词 / 字幕</th><th>镜头 / 声音</th><th>首尾连续性</th><th>AI 视频提示词</th><th>关联资产</th><th>制作备注</th><th>素材状态</th></tr></thead>
        <tbody>${storyboardRows.map((shot, index) => `
          <tr>
            <td><strong>第 ${escapeHtml(shot.shot)} 段</strong><br>${escapeHtml(shot.timeRange)}<br><small>成片 ${escapeHtml(shot.seconds)} 秒</small><br><small>生成 ${escapeHtml(shot.generationSeconds || shot.seconds)} 秒${Number(shot.trimSeconds || 0) ? ` · 裁 ${escapeHtml(shot.trimSeconds)} 秒` : ""}</small><br><button class="segment-copy-button" type="button" data-copy-storyboard-segment="${index}">复制本段</button></td>
            <td>${escapeHtml(shot.segmentGoal)}</td>
            <td><strong>${escapeHtml(shot.characters)}</strong><br>${escapeHtml(shot.scene)}</td>
            <td>${beats(shot.beatBreakdown)}<small>${escapeHtml(shot.visual)}；${escapeHtml(shot.action)}</small></td>
            <td>${escapeHtml(shot.line)}<br><small>${escapeHtml(shot.subtitle)}</small></td>
            <td>${escapeHtml(shot.scale)} · ${escapeHtml(shot.movement)}<br><small>${escapeHtml(shot.sound)}</small></td>
            <td><small>承接入点</small><br>${escapeHtml(shot.continuityIn)}<br><small>承接出点</small><br>${escapeHtml(shot.continuityOut)}</td>
            <td>${escapeHtml(shot.visualPrompt)}</td>
            <td><input data-shot-field="assetLinks" data-shot-index="${index}" value="${escapeHtml(shot.assetLinks)}" placeholder="资产库名称 / 待采集素材" /></td>
            <td><input data-shot-field="assetNote" data-shot-index="${index}" value="${escapeHtml(shot.assetNote)}" placeholder="负责人、截止时间或备注" /></td>
            <td><select data-shot-field="assetStatus" data-shot-index="${index}">${statusOptions.map((status) => `<option value="${status}" ${shot.assetStatus === status ? "selected" : ""}>${status}</option>`).join("")}</select></td>
          </tr>`).join("")}</tbody>
      </table>`;
  }

  function historyMeta(item) {
    return [
      item.mode === "continue" ? "续写" : "新生成",
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

  return { escapeHtml, formatItem, renderList, emptyStudio, script, table, storyboard, history };
});
