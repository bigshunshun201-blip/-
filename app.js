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
    topicBatch: 0,
  };

  const draftKey = "roco-shortdrama-studio-draft";
  const historyKey = "roco-shortdrama-studio-history";
  const accessCodeKey = "roco-shortdrama-access-code";
  const maxHistoryItems = 60;

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

  function pulseResult() {
    const stage = $(".stage");
    if (!stage) return;
    stage.classList.remove("pulse");
    void stage.offsetWidth;
    stage.classList.add("pulse");
  }

  function getInput() {
    return {
      theme: $("#theme").value.trim(),
      roles: $("#roles").value.trim(),
      direction: $("#direction").value,
      audience: $("#audience").value,
      duration: Number($("#duration").value),
      episodeCount: Number($("#episodeCount").value),
      style: $("#style").value,
      aiModel: $("#aiModel") ? $("#aiModel").value : "",
      continueInstruction: $("#continueInstruction") ? $("#continueInstruction").value.trim() : "",
    };
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
      `核心情绪：${topic.emotion}`,
      `关键反转：${topic.reversal}`,
      topic.series ? "按连续短剧结构处理，结尾必须留下一集钩子。" : "优先做成单集强反转短剧。",
    ].join("\n");
  }

  function applyTopicToInputs(topic) {
    state.selectedTopic = topic;
    setInputValue("theme", topic.title);
    setInputValue("direction", topicPrompt(topic));
    setInputValue("audience", topic.audience);
    setInputValue("duration", topic.duration);
    switchTab("script");
    saveDraft(false);
  }

  async function generateFromTopic(index) {
    const topic = state.topics[index];
    if (!topic) throw new Error("没有找到这个选题，请先重新生成选题库。");
    applyTopicToInputs(topic);
    await runGeneration("new");
  }

  async function continueFromTopic(index) {
    const topic = state.topics[index];
    if (!topic) throw new Error("没有找到这个选题，请先重新生成选题库。");
    if (!state.script) throw new Error("还没有可续写的剧本，请先用这个选题生成第一集。");
    applyTopicToInputs(topic);
    setInputValue(
      "continueInstruction",
      [
        "沿着这个选题继续生成下一集，不要重写上一集。",
        topicPrompt(topic),
        "承接当前剧本结尾钩子，升级冲突，保留同一组核心角色。",
      ].join("\n"),
    );
    await runGeneration("continue");
  }

  function normalizeTopicList(topics) {
    return (Array.isArray(topics) ? topics : [])
      .map((topic, index) => ({
        title: String(topic.title || "").trim(),
        sellingPoint: String(topic.sellingPoint || topic.selling_point || "").trim(),
        audience: String(topic.audience || topic.targetAudience || "洛克王国短剧用户").trim(),
        emotion: String(topic.emotion || topic.emotionPoint || "悬疑、怀旧").trim(),
        reversal: String(topic.reversal || topic.reversalPoint || "").trim(),
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
    const baseAudience = input.audience || "洛克王国短剧用户";
    const pool = [
      ["迪莫收到一封十年后的求救信", "未来信件+伙伴羁绊，适合做连续悬疑", baseAudience, "紧张、怀旧、守护", "写信的人不是未来的洛克，而是未来的迪莫", 75, true],
      ["魔法学院禁止提起第一只宠物", "禁忌规则开局，首秒冲突强", "剧情党、设定党", "好奇、压迫、反抗", "禁令是为了防止旧契约集体觉醒", 60, true],
      ["全王国都说这只宠物已经不存在", "存在感消失危机，情绪代入强", "老玩家、情感向用户", "孤独、亏欠、重逢", "宠物不是消失，而是在替主人挡遗忘诅咒", 80, true],
      ["最弱新生被分到废弃宠物仓库", "弱者逆袭+学院地图，可持续扩展", "学生党、爽剧用户", "委屈、热血、逆袭", "废弃仓库其实藏着学院最早的守护契约", 75, true],
      ["旧徽章每晚都会多出一个名字", "道具悬疑，适合作为系列主线", "设定党、悬疑用户", "不安、使命感", "新增名字代表下一位会被遗忘的小洛克", 90, true],
      ["宠物进化考试那天，它故意交白卷", "进化选择带来强情绪冲突", "亲子/情感向用户", "纠结、心疼、感动", "它不进化是因为进化后会忘记主人声音", 76, true],
      ["洛克王国的期末题，答案是逃出学院", "校园整活转悬疑，评论参与度高", "学生党、轻喜剧用户", "好笑、紧张、反差", "试卷不是考试，而是学院发出的求救地图", 45, true],
      ["我删号前，宠物给我留下最后一条留言", "离别场景强，适合催泪短剧", "老玩家、治愈向用户", "遗憾、释怀、重逢", "留言不是过去录的，而是宠物刚刚发来的", 60, true],
      ["暗影博士偷走的不是徽章，是玩家名字", "反派目标升级，主线感强", "剧情党、战斗向用户", "危机、愤怒、燃", "名字被偷后，所有宠物都会忘记自己的主人", 75, true],
      ["小时候的我成了本集最终 Boss", "自我对话+反转，适合系列中段", "老玩家、治愈向用户", "震惊、遗憾、释怀", "Boss 阻止长大的洛克，是怕他再次离开王国", 90, true],
      ["没人敢打开的背包格子亮了", "一个道具制造强悬念，拍摄成本低", "泛短剧用户", "好奇、惊喜、怀旧", "亮起的不是宠物，而是一段被封存的契约记忆", 60, true],
      ["全班宠物都黑化，只有最胆小那只没变", "反差救场，适合爽点剪辑", "学生党、爽剧用户", "恐惧、反差、热血", "胆小让它从未触碰暗影力量，反而成了唯一解药", 70, true],
    ];
    const used = new Set(state.topics.map((topic) => topic.title));
    const start = state.topicBatch % pool.length;
    const rotated = [...pool.slice(start), ...pool.slice(0, start)];
    return rotated
      .filter((item) => !used.has(item[0]))
      .slice(0, count)
      .map((item, index) => ({
        title: item[0],
        sellingPoint: item[1],
        audience: item[2],
        emotion: item[3],
        reversal: item[4],
        duration: item[5],
        series: item[6],
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
      const topics = normalizeTopicList(response.result?.topics);
      if (!topics.length) throw new Error("AI 没有返回可用选题");
      state.topics = topics;
      refreshTopicDerivedViews();
      switchTab("topics");
      setStatus(`AI 已换一批选题 ${nowTime()} · ${response.model || "model"}`);
    } catch (error) {
      const topics = fallbackTopics(8);
      if (!topics.length) throw error;
      state.topics = topics;
      refreshTopicDerivedViews();
      switchTab("topics");
      setStatus(`AI 换题失败，已用本地备选换一批：${error.message}`, true);
    }
  }

  async function replaceTopic(index) {
    const oldTopic = state.topics[index];
    if (!oldTopic) throw new Error("没有找到要替换的选题。");
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
      const topics = normalizeTopicList(response.result?.topics);
      if (!topics.length) throw new Error("AI 没有返回可用替换选题");
      state.topics.splice(index, 1, topics[0]);
      refreshTopicDerivedViews();
      setStatus(`已替换 1 条选题 ${nowTime()} · ${response.model || "model"}`);
    } catch (error) {
      const topics = fallbackTopics(1);
      if (!topics.length) throw error;
      state.topics.splice(index, 1, topics[0]);
      refreshTopicDerivedViews();
      setStatus(`AI 替换失败，已用本地备选替换：${error.message}`, true);
    }
  }

  function accessHeaders(payload) {
    const headers = payload ? { "Content-Type": "application/json" } : {};
    const code = window.localStorage.getItem(accessCodeKey);
    if (code) headers["X-Roco-Access-Code"] = code;
    return headers;
  }

  async function fetchApi(path, payload) {
    const response = await fetch(path, {
      method: payload ? "POST" : "GET",
      headers: accessHeaders(payload),
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `请求失败：${response.status}`);
      error.code = data.code;
      throw error;
    }
    return data;
  }

  async function apiRequest(path, payload) {
    try {
      return await fetchApi(path, payload);
    } catch (error) {
      if (error.code !== "ACCESS_CODE_REQUIRED") throw error;
      const code = window.prompt("请输入访问码。这个工具会调用你的付费 AI API，请不要把访问码发给不需要使用的人。");
      if (!code) throw error;
      window.localStorage.setItem(accessCodeKey, code.trim());
      return fetchApi(path, payload);
    }
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
        action: shot.action || "",
        line: shot.line || "",
        scale: shot.scale || "",
        movement: shot.movement || "",
        sound: shot.sound || "",
        subtitle: shot.subtitle || "",
      })),
      creativePack: result.creativePack || null,
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderList(title, items) {
    return `
      <section class="content-block">
        <h3>${escapeHtml(title)}</h3>
        <ul>${items.map((item) => `<li>${escapeHtml(formatItem(item))}</li>`).join("")}</ul>
      </section>
    `;
  }

  function formatItem(item) {
    if (typeof item === "string") return item;
    if (item.name && item.description) return `${item.name}：${item.description}`;
    if (item.beat && item.content) return `${item.beat}：${item.content}`;
    if (item.role && item.line) return `${item.role}：“${item.line}”`;
    return Object.values(item).join("：");
  }

  function renderScript() {
    const script = state.script;
    if (!script) return;
    $("#scriptTitle").textContent = script.title;
    $("#scriptOutput").innerHTML = `
      <section class="content-block">
        <h3>故事梗概</h3>
        <p>${escapeHtml(script.synopsis)}</p>
        <div class="tagline">${(script.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      </section>
      ${renderList("人物设定", script.characters || [])}
      ${renderList("剧情结构", script.structure || [])}
      ${renderList("台词", script.dialogue || [])}
      ${renderList("情绪节奏", script.rhythm || [])}
      ${renderList("反转点", script.reversals || [])}
      ${renderList("爆点与结尾钩子", script.hooks || [])}
    `;
  }

  function renderTable(target, rows, columns) {
    if (!rows.length) {
      target.innerHTML = `<p class="helper">暂无数据。</p>`;
      return;
    }

    target.innerHTML = `
      <table>
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  ${columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join("")}
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderStoryboard() {
    renderTable($("#storyboardTable"), state.storyboard, [
      { key: "shot", label: "镜头" },
      { key: "seconds", label: "时长" },
      { key: "visual", label: "画面内容" },
      { key: "action", label: "角色动作" },
      { key: "line", label: "台词/旁白" },
      { key: "scale", label: "景别" },
      { key: "movement", label: "运镜" },
      { key: "sound", label: "音效/BGM" },
      { key: "subtitle", label: "字幕" },
    ]);
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
          <p class="eyebrow">Topic reference</p>
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

  function historyMeta(item) {
    return [
      item.mode === "continue" ? "续写" : "新生成",
      item.model || "model",
      `${item.storyboard?.length || 0}镜`,
      `${item.input?.duration || "-"}秒`,
    ].filter(Boolean);
  }

  function renderHistory() {
    const target = $("#historyList");
    if (!target) return;
    if (!state.history.length) {
      target.innerHTML = `<p class="helper">还没有生成记录。每次点击 AI 生成或 AI 续写后，结果都会自动保存在这里。</p>`;
      return;
    }
    target.innerHTML = state.history
      .map((item, index) => {
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
                <div class="tagline">
                  ${(item.script?.tags || []).slice(0, 5).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
                </div>
              </div>
              <div class="history-actions">
                <button class="small-action" data-history-restore="${index}">查看/恢复</button>
                <button class="small-action" data-history-continue="${index}">基于它续写</button>
                <button class="small-action" data-history-pin="${index}">${item.pinned ? "取消入围" : "标记入围"}</button>
                <button class="small-action danger-action" data-history-delete="${index}">删除</button>
              </div>
            </div>
            ${
              hooks.length
                ? `<div class="history-hooks">${hooks
                    .slice(0, 3)
                    .map((hook) => `<span>${escapeHtml(formatItem(hook))}</span>`)
                    .join("")}</div>`
                : ""
            }
          </article>
        `;
      })
      .join("");
  }

  function loadHistory() {
    try {
      const raw = window.localStorage.getItem(historyKey);
      state.history = raw ? JSON.parse(raw) : [];
    } catch (error) {
      state.history = [];
    }
    renderHistory();
  }

  function persistHistory() {
    try {
      window.localStorage.setItem(historyKey, JSON.stringify(state.history.slice(0, maxHistoryItems)));
    } catch (error) {
      setStatus("生成记录保存失败：浏览器本地存储空间可能已满", true);
    }
  }

  function addHistoryItem({ mode, input, response, generated }) {
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
      pinned: false,
    };
    state.history = [item, ...state.history].slice(0, maxHistoryItems);
    persistHistory();
    renderHistory();
  }

  function restoreHistoryItem(index, keepInstruction = false) {
    const item = state.history[index];
    if (!item) throw new Error("没有找到这条生成记录。");
    Object.entries(item.input || {}).forEach(([key, value]) => {
      if (key === "continueInstruction" && keepInstruction) return;
      setInputValue(key, value);
    });
    state.script = item.script;
    state.storyboard = item.storyboard || [];
    state.creativePack = item.creativePack || null;
    renderScript();
    renderStoryboard();
    renderCreativePack();
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
            <p><strong>情绪：</strong>${escapeHtml(topic.emotion)}</p>
            <p><strong>反转：</strong>${escapeHtml(topic.reversal)}</p>
            <div class="tagline">
              <span class="tag">${escapeHtml(topic.duration)}秒</span>
              <span class="tag">${topic.series ? "适合系列化" : "单集更合适"}</span>
              <span class="tag">优先级 ${escapeHtml(topic.priority)}</span>
            </div>
            <div class="topic-actions">
              <button class="small-action" data-topic-generate="${index}">用这个选题生成本集</button>
              <button class="small-action" data-topic-continue="${index}">沿这个选题续写下一集</button>
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
    if (mode === "continue" && !state.script) {
      throw new Error("还没有可续写的剧本，请先生成一集。");
    }
    setStatus(mode === "continue" ? "AI 续写中..." : "AI 生成中...");
    const response = await apiRequest("/api/generate", {
      input: {
        ...input,
        mode,
        competitorInsights: state.analysis ? state.analysis.summary : "",
        previousScript: mode === "continue" ? state.script : null,
        previousStoryboard: mode === "continue" ? state.storyboard : null,
      },
    });
    const generated = normalizeGeneratedResult(response.result);
    state.script = generated.script;
    state.storyboard = generated.storyboard;
    state.creativePack = generated.creativePack || window.RocoStudio.generateCreativePack(state.script, input, state.topics);
    addHistoryItem({ mode, input, response, generated: { ...generated, creativePack: state.creativePack } });
    renderScript();
    renderStoryboard();
    renderCreativePack();
    renderHistory();
    renderExample();
    saveDraft(false);
    pulseResult();
    setStatus(
      `${mode === "continue" ? "AI 已续写" : "AI 已生成"} ${nowTime()} · ${response.source || "provider"} · ${response.model || "model"}`,
    );
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
        setStatus(`AI 已连接 · ${status.provider || "provider"} · ${status.model}`);
      } else {
        setStatus("AI 未连接：请配置 AI_PROVIDER 和对应 API Key 后重启 server.js", true);
      }
    } catch (error) {
      setStatus("未连接本地 AI 服务：请用 node server.js 启动", true);
    }
  }

  function saveDraft(showStatus = true) {
    const payload = {
      input: getInput(),
      competitorCsv: $("#competitorCsv").value,
      topics: state.topics,
      analysis: state.analysis,
      competitors: state.competitors,
      savedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(payload));
      if (showStatus) setStatus("草稿已保存");
    } catch (error) {
      if (showStatus) setStatus("当前浏览器未开放本地保存", true);
    }
  }

  function restoreDraft() {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      Object.entries(draft.input || {}).forEach(([key, value]) => {
        const el = document.getElementById(key);
        if (el) el.value = value;
      });
      $("#competitorCsv").value = draft.competitorCsv || "";
      state.topics = normalizeTopicList(draft.topics);
      state.analysis = draft.analysis || null;
      state.competitors = Array.isArray(draft.competitors) ? draft.competitors : [];
      setStatus("已恢复草稿");
    } catch (error) {
      try {
        window.localStorage.removeItem(draftKey);
      } catch (_) {
        // Ignore storage cleanup failures in restricted browser contexts.
      }
    }
  }

  function switchTab(tabName) {
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
    $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${tabName}`));
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
    $("#generateBtn").addEventListener("click", async () => {
      try {
        await generateAll();
      } catch (error) {
        if (["NO_API_KEY", "NO_DEEPSEEK_KEY", "NO_PROVIDER"].includes(error.code)) {
          setStatus("AI 未连接：请先配置 AI_PROVIDER 和对应 API Key，再重启 node server.js", true);
          return;
        }
        reportError("生成", error);
      }
    });
    $("#continueBtn").addEventListener("click", async () => {
      try {
        await continueEpisode();
      } catch (error) {
        if (["NO_API_KEY", "NO_DEEPSEEK_KEY", "NO_PROVIDER"].includes(error.code)) {
          setStatus("AI 未连接：请先配置 AI_PROVIDER 和对应 API Key，再重启 node server.js", true);
          return;
        }
        reportError("续写", error);
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
    $("#topicGrid").addEventListener("click", async (event) => {
      const generateButton = event.target.closest("[data-topic-generate]");
      const continueButton = event.target.closest("[data-topic-continue]");
      const replaceButton = event.target.closest("[data-topic-replace]");
      if (!generateButton && !continueButton && !replaceButton) return;
      try {
        if (generateButton) await generateFromTopic(Number(generateButton.dataset.topicGenerate));
        if (continueButton) await continueFromTopic(Number(continueButton.dataset.topicContinue));
        if (replaceButton) await replaceTopic(Number(replaceButton.dataset.topicReplace));
      } catch (error) {
        reportError(generateButton ? "选题生成" : continueButton ? "选题续写" : "替换选题", error);
      }
    });
    $$("[data-copy]").forEach((button) => {
      button.addEventListener("click", () => copyElementText(button.dataset.copy));
    });
  }

  function init() {
    if (!window.RocoStudio) {
      setStatus("生成器未加载，请用本地服务打开或刷新缓存", true);
      return;
    }
    try {
      bindEvents();
      restoreDraft();
      loadHistory();
      if (state.topics.length) {
        refreshTopicDerivedViews();
      } else {
        analyzeAll();
      }
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
