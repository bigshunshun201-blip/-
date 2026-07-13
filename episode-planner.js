(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoEpisodePlanner = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const requiredPlanKeys = ["openingHook", "conflict", "reversal", "endingSuspense", "targetEmotion"];

  function clean(value, fallback = "") {
    return String(value || "").trim() || fallback;
  }

  function roleNames(roles) {
    const names = clean(roles)
      .split(/[\n；;,，]+/)
      .map((item) => item.split(/[：:]/)[0].trim())
      .filter(Boolean);
    return [...new Set(names)];
  }

  function hashText(value) {
    return [...String(value)].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
  }

  function rotate(items, offset) {
    const index = Math.abs(offset) % items.length;
    return [...items.slice(index), ...items.slice(0, index)];
  }

  function planIsComplete(plan = {}) {
    return requiredPlanKeys.every((key) => clean(plan[key]));
  }

  function contextFor(input = {}, options = {}) {
    const topic = options.topic || {};
    const names = roleNames(input.roles || topic.roles);
    return {
      theme: clean(input.theme || topic.title, "一场无法回避的精灵危机"),
      scene: clean(input.scene || topic.world, "当前探索区域"),
      lead: names[0] || "小洛克",
      partner: names[1] || "搭档精灵",
      opponent: names[2] || "神秘对手",
      direction: clean(input.direction || topic.sellingPoint, "冒险悬疑"),
      reversalSeed: clean(topic.reversal, "真正的危险来自被忽略的契约规则"),
      emotion: clean(topic.emotion || input.style, "紧张 -> 错愕 -> 追更悬念"),
      meme: clean(input.memeSeed || topic.memeLine),
      previousHook: clean(options.previousHook),
    };
  }

  function templates(ctx) {
    const memeBeat = ctx.meme ? `，${ctx.partner}还丢下一句“${ctx.meme.slice(0, 28)}”` : "";
    const continuation = ctx.previousHook ? `上一集留下的“${ctx.previousHook.slice(0, 42)}”刚被验证，` : "";
    return [
      {
        angle: "危机先行",
        title: "先让观众看到不可逆的代价",
        why: "适合动作、悬疑和强完播结构",
        plan: {
          openingHook: `${continuation}${ctx.scene}的契约倒计时突然只剩 10 秒，${ctx.partner}却让${ctx.lead}别救自己。`,
          conflict: `${ctx.lead}必须在倒计时结束前阻止${ctx.opponent}带走${ctx.partner}，但强行出手会让契约永久失效。`,
          reversal: `倒计时不是${ctx.opponent}启动的；${ctx.partner}早已知道${ctx.reversalSeed}，并在主动隐瞒代价。`,
          endingSuspense: `${ctx.lead}刚停下倒计时，自己的契约印记却开始消失。下一集必须回答：被系统判定离开的到底是谁？`,
          targetEmotion: "紧迫压迫 -> 误判反转 -> 失去恐惧",
        },
      },
      {
        angle: "关系反差",
        title: "先把最亲近的人推到对立面",
        why: "适合怀旧、羁绊和评论区站队",
        plan: {
          openingHook: `${ctx.lead}终于在${ctx.scene}找到${ctx.partner}，它第一句话却是：“我不认识你。”${memeBeat}`,
          conflict: `${ctx.partner}公开站到${ctx.opponent}一边，${ctx.lead}要在不伤害它的前提下证明两人的共同记忆不是伪造的。`,
          reversal: `${ctx.partner}并未失忆，它故意否认${ctx.lead}，是因为只要承认关系，${ctx.opponent}就能顺着契约锁定${ctx.lead}。`,
          endingSuspense: `${ctx.partner}暗中塞来一枚陌生徽记，上面却刻着${ctx.lead}尚未经历过的日期。下一集追查这段“未来记忆”。`,
          targetEmotion: "重逢期待 -> 被背叛委屈 -> 心疼与疑问",
        },
      },
      {
        angle: "轻喜误导",
        title: "用笑点掩护真正的危险",
        why: "适合热梗、快节奏和反差传播",
        plan: {
          openingHook: `${ctx.scene}所有精灵突然开始重复${ctx.partner}的口头禅，只有${ctx.lead}笑不出来：它们的影子全指向同一个出口。`,
          conflict: `${ctx.lead}一边阻止精灵们把异常当成整活挑战，一边要在${ctx.opponent}封锁出口前找到传播源。`,
          reversal: `看似搞笑的重复行为其实是${ctx.partner}发出的求救编码；真正被控制的不是精灵，而是现场所有训练者的判断。`,
          endingSuspense: `编码解完只得到一句话：“不要相信下一集出现的${ctx.lead}。”镜头外随即传来一模一样的声音。`,
          targetEmotion: "荒诞好笑 -> 集体失控 -> 身份悬疑",
        },
      },
      {
        angle: "规则陷阱",
        title: "把能力限制变成本集核心矛盾",
        why: "适合强化短剧圣经和世界可信度",
        plan: {
          openingHook: `${ctx.partner}在${ctx.scene}使出最熟悉的能力，命中的却是未来 30 秒后的${ctx.lead}。`,
          conflict: `${ctx.lead}必须在能力再次触发前找出规则漏洞，同时避开${ctx.opponent}故意制造的错误目标。`,
          reversal: `${ctx.reversalSeed}；${ctx.partner}每使用一次能力，都会把一个错误结果提前变成现实。`,
          endingSuspense: `${ctx.lead}封住了${ctx.partner}的能力，${ctx.opponent}却展示了同样的契约印记。下一集要确认两者是否共享同一力量来源。`,
          targetEmotion: "视觉惊奇 -> 规则焦虑 -> 世界观震动",
        },
      },
      {
        angle: "选择困境",
        title: "让主角必须失去其中一个目标",
        why: "适合催泪、人物成长和系列主线",
        plan: {
          openingHook: `${ctx.lead}只来得及救一个：困在${ctx.scene}的${ctx.partner}，或装着整片区域记忆的核心。`,
          conflict: `${ctx.opponent}逼${ctx.lead}在私人羁绊与区域安全之间选择，任何拖延都会让两边同时崩溃。`,
          reversal: `${ctx.partner}才是核心记忆的真正载体；救下区域意味着必须亲手抹去它与${ctx.lead}的全部经历。`,
          endingSuspense: `${ctx.lead}做出选择后，${ctx.partner}醒来喊出的却是${ctx.opponent}的名字。下一集确认记忆究竟转移给了谁。`,
          targetEmotion: "两难窒息 -> 主动牺牲 -> 心碎悬念",
        },
      },
      {
        angle: "公开审判",
        title: "让围观者和评论区一起误判主角",
        why: "适合争议、站队和互动评论",
        plan: {
          openingHook: `${ctx.scene}的大屏突然播放${ctx.lead}伤害${ctx.partner}的完整影像，周围所有人要求立刻解除契约。`,
          conflict: `${ctx.lead}只有一次公开自证机会，但每拿出一条证据，${ctx.opponent}就能展示更完整的反证。`,
          reversal: `影像没有造假，真正被调换的是事件发生的先后顺序；${ctx.lead}当时是在阻止更严重的契约污染。`,
          endingSuspense: `众人刚准备道歉，${ctx.partner}却承认最后一段影像是真的。下一集必须揭开它为何反过来指控${ctx.lead}。`,
          targetEmotion: "愤怒误解 -> 证据反杀 -> 再次怀疑",
        },
      },
    ];
  }

  function generatePlanOptions(input = {}, options = {}) {
    const ctx = contextFor(input, options);
    const count = Math.max(1, Math.min(Number(options.count || 3), 6));
    const seed = Number(options.seed) || hashText(`${ctx.theme}|${ctx.scene}|${ctx.direction}`);
    return rotate(templates(ctx), seed).slice(0, count).map((item, index) => ({
      ...item,
      id: `plan-${seed}-${index}`,
      plan: { ...item.plan },
    }));
  }

  function completePlan(input = {}, options = {}) {
    const current = input.episodePlan || {};
    const suggested = generatePlanOptions(input, { ...options, count: 1 })[0].plan;
    return Object.fromEntries(requiredPlanKeys.map((key) => [key, clean(current[key]) || suggested[key]]));
  }

  function normalizePlanOptions(result = {}, options = {}) {
    const source = Array.isArray(result?.plans)
      ? result.plans
      : Array.isArray(result?.options)
        ? result.options
        : Array.isArray(result)
          ? result
          : [];
    const prefix = clean(options.prefix, "plan");
    return source.slice(0, 3).map((item, index) => {
      const plan = item?.plan && typeof item.plan === "object" ? item.plan : item || {};
      return {
        id: clean(item?.id, `${prefix}-${Date.now()}-${index}`),
        angle: clean(item?.angle, `方案 ${index + 1}`),
        title: clean(item?.title, "未命名策划"),
        why: clean(item?.why, "根据当前创作资料生成"),
        innovation: clean(item?.innovation),
        memeMechanic: clean(item?.memeMechanic),
        visualSetpiece: clean(item?.visualSetpiece),
        plan: Object.fromEntries(requiredPlanKeys.map((key) => [key, clean(plan[key])])),
      };
    }).filter((item) => planIsComplete(item.plan));
  }

  return { requiredPlanKeys, planIsComplete, generatePlanOptions, completePlan, normalizePlanOptions };
});
