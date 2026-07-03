(function () {
  "use strict";

  const constants = {
    accountFields: [
      { key: "account_id", label: "账号唯一编号" },
      { key: "platform", label: "平台" },
      { key: "account_name", label: "账号名称" },
      { key: "account_positioning", label: "账号定位" },
      { key: "follower_count", label: "粉丝数" },
      { key: "posting_frequency", label: "发布频率" },
      { key: "main_content_type", label: "内容类型" },
      { key: "cover_style", label: "封面风格" },
      { key: "fan_growth_30d", label: "30天涨粉" },
      { key: "notes", label: "观察备注" },
    ],
    videoFields: [
      { key: "video_id", label: "视频编号" },
      { key: "account_id", label: "关联账号" },
      { key: "publish_time", label: "发布时间" },
      { key: "title", label: "视频标题" },
      { key: "cover_text", label: "封面文字" },
      { key: "duration_sec", label: "时长" },
      { key: "opening_hook", label: "前3秒钩子" },
      { key: "plot_conflict", label: "核心冲突" },
      { key: "reversal_point", label: "反转点" },
      { key: "ending_hook", label: "结尾钩子" },
      { key: "likes", label: "点赞数" },
      { key: "comments", label: "评论数" },
      { key: "favorites", label: "收藏数" },
      { key: "shares", label: "转发数" },
      { key: "views", label: "播放量" },
      { key: "completion_rate", label: "完播率" },
      { key: "follower_gain", label: "单条涨粉" },
    ],
    commentFields: [
      { key: "comment_id", label: "评论编号" },
      { key: "video_id", label: "关联视频" },
      { key: "comment_text", label: "评论内容" },
      { key: "like_count", label: "评论点赞" },
      { key: "sentiment", label: "情绪标签" },
      { key: "demand_type", label: "用户需求" },
      { key: "usable_insight", label: "可转选题洞察" },
    ],
    topicFields: [
      { key: "topic_id", label: "选题编号" },
      { key: "title", label: "标题" },
      { key: "selling_point", label: "剧情卖点" },
      { key: "target_audience", label: "目标人群" },
      { key: "emotion_point", label: "情绪点" },
      { key: "reversal_point", label: "反转点" },
      { key: "duration_sec", label: "适合时长" },
      { key: "series_potential", label: "是否系列化" },
      { key: "priority_score", label: "优先级" },
      { key: "status", label: "生产状态" },
    ],
  };

  const seedCompetitors = [
    {
      accountName: "魔法怀旧剧场A",
      positioning: "游戏怀旧短剧",
      title: "十年前的宠物还记得你吗",
      coverStyle: "宠物特写+大字冲突",
      publishTime: "20:30",
      duration: 58,
      likes: 82000,
      comments: 6200,
      favorites: 11000,
      shares: 9000,
      views: 1800000,
      hitReason: "前3秒抛出等待十年的情绪钩子，结尾留续集问题",
      feedback: "童年回来了、想看下一集、我的第一只宠物是谁",
      theme: "童年重逢",
    },
    {
      accountName: "王国档案室B",
      positioning: "宠物设定解说",
      title: "当年最难抓的宠物现在怎么样了",
      coverStyle: "老画面拼接+排行榜",
      publishTime: "12:10",
      duration: 74,
      likes: 35000,
      comments: 2100,
      favorites: 8600,
      shares: 3200,
      views: 900000,
      hitReason: "信息密度高，适合收藏和转发给老玩家",
      feedback: "求盘点更多宠物、这只我抓过、想看进化线",
      theme: "宠物盘点",
    },
    {
      accountName: "学院逆袭社C",
      positioning: "魔法学院爽剧",
      title: "最弱宠物被全班嘲笑后觉醒",
      coverStyle: "表情反差+战斗光效",
      publishTime: "18:00",
      duration: 82,
      likes: 120000,
      comments: 9800,
      favorites: 15000,
      shares: 12000,
      views: 2600000,
      hitReason: "弱者逆袭结构清晰，中段有战斗反转",
      feedback: "燃起来了、下一集打谁、这宠物以前真的弱吗",
      theme: "废柴逆袭",
    },
    {
      accountName: "小洛克整活D",
      positioning: "游戏生活化整活",
      title: "如果洛克王国也有班主任",
      coverStyle: "搞笑表情包+课堂场景",
      publishTime: "22:15",
      duration: 45,
      likes: 51000,
      comments: 7600,
      favorites: 4200,
      shares: 6800,
      views: 1300000,
      hitReason: "把游戏设定嫁接校园生活，评论区代入强",
      feedback: "太真实了、像我小学老师、求出期末考试篇",
      theme: "校园整活",
    },
  ];

  function clean(value, fallback) {
    const text = String(value || "").trim();
    return text || fallback;
  }

  function splitRoles(value) {
    return clean(value, "阿洛：回归老玩家；迪莫：童年搭档；黑袍人：寻找旧契约的人")
      .split(/[；;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function pct(value) {
    return `${(value * 100).toFixed(value > 0.1 ? 1 : 2)}%`;
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function interactionRate(row) {
    const views = Math.max(num(row.views), 1);
    return (num(row.likes) + num(row.comments) + num(row.favorites) + num(row.shares)) / views;
  }

  function scoreCompetitors(rows = seedCompetitors) {
    return rows.map((row) => {
      const views = Math.max(num(row.views), 1);
      const likeRate = num(row.likes) / views;
      const commentRate = num(row.comments) / views;
      const saveRate = num(row.favorites) / views;
      const shareRate = num(row.shares) / views;
      const score = Math.round(
        Math.min(likeRate / 0.06, 1) * 30 +
          Math.min(commentRate / 0.005, 1) * 25 +
          Math.min(saveRate / 0.012, 1) * 20 +
          Math.min(shareRate / 0.008, 1) * 25,
      );
      const diagnosis = [
        commentRate > 0.004 ? "评论欲强" : "评论钩子弱",
        shareRate > 0.004 ? "适合转发" : "转发理由不足",
        saveRate > 0.006 ? "有收藏价值" : "信息资产偏少",
      ].join(" / ");
      return {
        ...row,
        interactionRate: pct(interactionRate(row)),
        commentRate: pct(commentRate),
        saveShareRate: pct(saveRate + shareRate),
        viralScore: score,
        diagnosis,
      };
    });
  }

  function generateScript(input = {}) {
    const theme = clean(input.theme, "十年前的迪莫被重新召回");
    const roles = splitRoles(input.roles);
    const direction = clean(input.direction, "童年重逢 + 悬疑反转");
    const audience = clean(input.audience, "18-30岁洛克王国老玩家");
    const duration = num(input.duration) || 60;
    const episodeCount = num(input.episodeCount) || 3;
    const style = clean(input.style, "怀旧、燃、结尾强钩子");
    const protagonist = roles[0].split(/[：:]/)[0] || "阿洛";
    const partner = roles[1]?.split(/[：:]/)[0] || "迪莫";
    const antagonist = roles[2]?.split(/[：:]/)[0] || "黑袍人";

    return {
      title: `《${theme}》第1集：它等了我3652天`,
      synopsis: `${protagonist}作为长大后的老玩家，重新打开魔法学院的旧入口，却看到系统提示“契约状态：失效”。他以为${partner}已经消失，旧背包里那枚裂开的契约徽章却突然发光。${partner}没有责怪他，只说“你还没说冒险结束”。就在两人准备重启任务时，${antagonist}锁定了这枚旧徽章，真正的目标不是宠物，而是小洛克们共同遗忘的童年记忆。本集面向${audience}，风格为${style}，单集控制在${duration}秒。`,
      characters: [
        { name: protagonist, description: "长大后的回归玩家，嘴上说只是看看，心里还记得第一只精灵。" },
        { name: partner, description: "童年搭档，战斗力不一定最强，但记得所有没完成的约定。" },
        { name: antagonist, description: "隐藏反派，擅长篡改记忆水晶，试图切断玩家与精灵的羁绊。" },
        { name: "学院广播", description: "用警报和任务提示推动剧情，适合做短视频信息卡。" },
      ],
      structure: [
        { beat: "0-3秒 强钩子", content: "手机弹出“你的精灵已等待3652天”，主角手指停住。" },
        { beat: "4-15秒 冲突", content: "旧账号登录成功，但系统显示契约失效，主角以为童年伙伴不在了。" },
        { beat: "16-35秒 重逢", content: "旧徽章发光，精灵从光里出现，说出只有主角知道的约定。" },
        { beat: "36-50秒 情绪爆点", content: "主角说自己已经长大，精灵回答“那这次换我保护长大的你”。" },
        { beat: `51-${duration}秒 反转钩子`, content: `${antagonist}出现，点出“第一枚旧契约徽章终于醒了”。` },
      ],
      dialogue: [
        { role: protagonist, line: "十年了，这个账号还能登？" },
        { role: "系统", line: "契约状态：失效。" },
        { role: protagonist, line: "果然，连你也不在了。" },
        { role: partner, line: "谁说我不在？" },
        { role: protagonist, line: "你怎么还记得我？我都长大了。" },
        { role: partner, line: "因为你还没说，冒险结束。" },
        { role: partner, line: "这次，换我保护长大的你。" },
        { role: antagonist, line: "终于找到了，第一枚旧契约徽章。" },
      ],
      rhythm: [
        "惊讶：用系统提示和数字制造停留。",
        "失落：契约失效，触发老玩家亏欠感。",
        "重逢：精灵出现，台词短而准。",
        "燃点：精灵主动守护主角。",
        "悬疑：反派目标从精灵转向徽章。",
      ],
      reversals: [
        "主角以为自己召回了精灵，其实是精灵一直守着旧契约。",
        "契约失效不是因为时间太久，而是记忆水晶被人篡改。",
        "反派要夺走的不是宠物，而是玩家和精灵的共同记忆。",
      ],
      hooks: [
        "下一集：旧徽章里为什么记录了所有小洛克的名字？",
        "评论互动：如果你的第一只精灵还在等你，你会先对它说什么？",
        `系列方向：${episodeCount}集内完成“重逢-学院危机-旧友反派-徽章觉醒”。`,
      ],
      tags: ["洛克王国二创", "粉丝向短剧", "童年回忆", "魔法学院", "精灵羁绊", direction],
    };
  }

  function roleName(role, fallback) {
    return clean(role, fallback).split(/[：:]/)[0] || fallback;
  }

  function inferScenario(theme, direction, style) {
    const text = `${theme} ${direction} ${style}`;
    if (/忘|失忆|不记得|陌生|记忆/.test(text)) return "memoryLoss";
    if (/最弱|嘲笑|逆袭|废柴|没人要|觉醒/.test(text)) return "underdog";
    if (/黑化|反派|暗影|危机|入侵|封印|Boss/i.test(text)) return "crisis";
    if (/考试|学院|禁忌|课堂|新生|院长|老师/.test(text)) return "academy";
    return "reunion";
  }

  function scenarioDeck(kind, names, input) {
    const { protagonist, partner, antagonist, theme, audience, duration, episodeCount, style, direction } = names;
    const decks = {
      memoryLoss: {
        titleSuffix: "它叫出了所有人的名字，唯独忘了我",
        synopsis: `${protagonist}带着${partner}回到魔法学院复查旧契约，却发现${partner}能记住训练场、老师和每一条任务路线，唯独不认识自己的主人。${protagonist}以为是自己离开太久造成的惩罚，直到学院记忆水晶里出现${antagonist}留下的划痕：有人把“主人”这个身份从${partner}的记忆里单独抹掉了。为了不让${partner}彻底变成无主精灵，${protagonist}必须在${duration}秒内找回两人第一次并肩战斗的证据。`,
        characterNotes: [
          `${protagonist}：表面冷静，实际被“它不记得我”击中，核心动作是证明自己没有抛弃伙伴。`,
          `${partner}：礼貌、疏离、战斗本能还在，但每次靠近主角都会头痛。`,
          `${antagonist}：不是直接抢宠物，而是精准删除羁绊记忆，让主人自己放弃。`,
        ],
        beats: [
          ["0-3秒 反常识钩子", `${partner}对所有人点头问好，却对${protagonist}说“请问你是谁？”`],
          ["4-15秒 情绪打击", `${protagonist}拿出旧徽章、旧任务截图、旧背包道具，${partner}全部没有反应。`],
          ["16-35秒 线索", "记忆水晶显示有一段记录被单独挖空，缺口形状正好是契约徽章。"],
          ["36-50秒 反转", `${partner}虽然忘了主人，却下意识挡在${protagonist}面前承受攻击。`],
          [`51-${duration}秒 钩子`, `${antagonist}出现：它不是忘了你，是你们的第一次冒险被我藏起来了。`],
        ],
        dialogue: [
          [partner, "请问你是谁？为什么我一看到你就想保护你？"],
          [protagonist, "你可以忘了我的名字，但不能忘了我们一起赢过。"],
          ["学院广播", "警告，契约记忆缺口正在扩大。"],
          [antagonist, "只要它忘了你，你就再也不是小洛克。"],
        ],
        reversals: ["失忆不是全量清除，而是只删除了“主人”身份。", "精灵忘了名字，却还保留保护主人的身体记忆。", "被藏起来的不是回忆，而是下一集的通关钥匙。"],
        hooks: ["下一集：他们第一次并肩战斗的地点，为什么被学院封锁？", `评论区：如果${partner}忘了你，你会先证明哪件事？`],
      },
      underdog: {
        titleSuffix: "没人要的精灵，救了全班",
        synopsis: `${protagonist}在魔法学院契约课上没有抢到热门精灵，只能选择被全班嫌弃的${partner}。所有人都说它技能慢、伤害低、不适合短剧里的战斗节奏。可当${antagonist}把全班的强力技能全部反弹时，只有${partner}那个“没用”的旧技能没有被识别成攻击。${protagonist}终于明白，弱不是缺点，而是这个关卡唯一的破解方式。`,
        characterNotes: [
          `${protagonist}：被迫选择弱宠，但拒绝把伙伴当临时工具。`,
          `${partner}：自卑但细心，记得每个同学的战斗习惯。`,
          `${antagonist}：利用强者自负布置反弹结界。`,
        ],
        beats: [
          ["0-3秒 爽点钩子", `全班嘲笑${protagonist}契约了没人要的${partner}。`],
          ["4-15秒 压迫", "强力宠物轮番展示技能，主角的小技能被弹幕刷“换掉”。"],
          ["16-35秒 危机", `${antagonist}开启反弹结界，越强的攻击反噬越重。`],
          ["36-50秒 觉醒", `${partner}的低伤旧技能绕过结界，救下第一个同学。`],
          [`51-${duration}秒 钩子`, "老师低声说：这不是弱宠，这是被故意压低评级的守护型精灵。"],
        ],
        dialogue: [
          ["同学", `你怎么选了${partner}？它连排行榜都进不去。`],
          [protagonist, "排行榜没写它会不会害怕，也没写它会不会保护人。"],
          [partner, "我可能打不赢他们，但我记得怎么救他们。"],
          [antagonist, "越强的人，越容易被自己的力量打败。"],
        ],
        reversals: ["最弱技能正好不触发反弹结界。", "没人要的精灵其实是守护型隐藏评级。", "嘲笑主角的同学第一个被主角救下。"],
        hooks: ["下一集：学院为什么故意把它排在最后一名？", `评论区：你想让${partner}进化，还是保持现在的样子？`],
      },
      academy: {
        titleSuffix: "禁忌课堂的第一道题",
        synopsis: `${protagonist}误入魔法学院封锁多年的禁忌课堂，黑板上自动写出一道题：如果你的精灵和全班只能救一个，你选谁？${partner}以为这是普通考试，准备牺牲自己换全班安全。${protagonist}却发现题目里少了一个选项：出题人从一开始就没打算让任何人通关。真正的考点不是选择谁，而是找出谁在操控课堂规则。`,
        characterNotes: [
          `${protagonist}：不按题目给的选项走，擅长质疑规则。`,
          `${partner}：把保护别人放在自己前面，是本集情绪爆点。`,
          `${antagonist}：伪装成考试系统，用选择题制造分裂。`,
        ],
        beats: [
          ["0-3秒 悬念钩子", "黑板写出选择题：精灵和全班，只能救一个。"],
          ["4-15秒 规则", "教室门锁死，倒计时开始，答错的人会失去契约。"],
          ["16-35秒 误导", `${partner}主动站到牺牲区，要求${protagonist}选全班。`],
          ["36-50秒 破题", `${protagonist}发现黑板上的题号不是1，而是0：这题本来就是陷阱。`],
          [`51-${duration}秒 钩子`, `${antagonist}的声音从广播出现：终于有人敢撕掉学院的标准答案。`],
        ],
        dialogue: [
          ["黑板", "第一题：精灵和全班，只能救一个。"],
          [partner, "选他们吧，我本来就是你的搭档，不是你的负担。"],
          [protagonist, "真正的伙伴，不会被一道题拆开。"],
          [antagonist, "答对了，所以下一题更难。"],
        ],
        reversals: ["考试题没有正确选项，目的是逼学生背叛契约。", "题号是0，说明这不是考试，而是入侵测试。", "禁忌课堂不是惩罚地，而是院长留下的警报器。"],
        hooks: ["下一集：第二题要求主角删除一段童年记忆。", "评论区：如果这题给你，你会怎么答？"],
      },
      crisis: {
        titleSuffix: "暗影入侵那天，旧徽章醒了",
        synopsis: `${antagonist}带着暗影裂缝入侵魔法学院，专门锁定老玩家留下的旧契约。${protagonist}原本只是想完成一次粉丝向回忆挑战，却被广播点名为“最后一位能启动旧徽章的人”。${partner}告诉他，王国不是要他回忆童年，而是要他承认自己仍然是小洛克。只有当主角重新说出当年的契约口令，旧徽章才会启动。`,
        characterNotes: [
          `${protagonist}：从旁观者被迫成为关键角色。`,
          `${partner}：知道危机真相，但害怕主人再次离开。`,
          `${antagonist}：目标是所有旧契约，想让王国失去老玩家记忆。`,
        ],
        beats: [
          ["0-3秒 危机钩子", `${antagonist}撕开学院天空，广播点名${protagonist}。`],
          ["4-15秒 召回", "所有新契约失效，只有旧徽章还在微弱发光。"],
          ["16-35秒 代价", `${partner}说启动徽章需要主角承认自己从未真正退出王国。`],
          ["36-50秒 燃点", `${protagonist}说出当年的契约口令，旧地图全部亮起。`],
          [`51-${duration}秒 钩子`, `${antagonist}笑了：很好，第一位旧契约者终于暴露了。`],
        ],
        dialogue: [
          ["学院广播", `${protagonist}，旧契约权限已被强制唤醒。`],
          [protagonist, "我只是回来看看，为什么会选中我？"],
          [partner, "因为你从来没说过，冒险结束。"],
          [antagonist, "只要旧契约者出现，王国的门就能被我打开。"],
        ],
        reversals: ["主角不是误入危机，而是危机一直在等他上线。", "旧徽章不是纪念品，是王国的备用权限。", "反派逼主角觉醒，是为了定位所有旧契约者。"],
        hooks: ["下一集：第二位旧契约者是谁？", "评论区：你还记得自己的契约口令吗？"],
      },
      reunion: {
        titleSuffix: "它等了我3652天",
        synopsis: `${protagonist}作为长大后的老玩家，重新打开魔法学院的旧入口，却看到系统提示“契约状态：失效”。他以为${partner}已经消失，旧背包里那枚裂开的契约徽章却突然发光。${partner}没有责怪他，只说“你还没说冒险结束”。就在两人准备重启任务时，${antagonist}锁定了这枚旧徽章，真正的目标不是宠物，而是小洛克们共同遗忘的童年记忆。`,
        characterNotes: [
          `${protagonist}：长大后的回归玩家，嘴上说只是看看，心里还记得第一只精灵。`,
          `${partner}：童年搭档，战斗力不一定最强，但记得所有没完成的约定。`,
          `${antagonist}：隐藏反派，擅长篡改记忆水晶，试图切断玩家与精灵的羁绊。`,
        ],
        beats: [
          ["0-3秒 强钩子", `手机弹出“${partner}已等待3652天”，${protagonist}手指停住。`],
          ["4-15秒 冲突", "旧账号登录成功，但系统显示契约失效，主角以为童年伙伴不在了。"],
          ["16-35秒 重逢", "旧徽章发光，精灵从光里出现，说出只有主角知道的约定。"],
          ["36-50秒 情绪爆点", "主角说自己已经长大，精灵回答“那这次换我保护长大的你”。"],
          [`51-${duration}秒 反转钩子`, `${antagonist}出现，点出“第一枚旧契约徽章终于醒了”。`],
        ],
        dialogue: [
          [protagonist, "十年了，这个账号还能登？"],
          ["系统", "契约状态：失效。"],
          [partner, "谁说我不在？"],
          [protagonist, "你怎么还记得我？我都长大了。"],
          [partner, "因为你还没说，冒险结束。"],
          [antagonist, "终于找到了，第一枚旧契约徽章。"],
        ],
        reversals: ["主角以为自己召回了精灵，其实是精灵一直守着旧契约。", "契约失效不是因为时间太久，而是记忆水晶被人篡改。", "反派要夺走的不是宠物，而是玩家和精灵的共同记忆。"],
        hooks: ["下一集：旧徽章里为什么记录了所有小洛克的名字？", "评论互动：如果你的第一只精灵还在等你，你会先对它说什么？"],
      },
    };
    return decks[kind] || decks.reunion;
  }

  function generateScriptV2(input = {}) {
    const theme = clean(input.theme, "十年前的迪莫被重新召回");
    const roles = splitRoles(input.roles);
    const direction = clean(input.direction, "童年重逢 + 悬疑反转");
    const audience = clean(input.audience, "18-30岁洛克王国老玩家");
    const duration = num(input.duration) || 60;
    const episodeCount = num(input.episodeCount) || 3;
    const style = clean(input.style, "怀旧、燃、结尾强钩子");
    const protagonist = roleName(roles[0], "阿洛");
    const partner = roleName(roles[1], "迪莫");
    const antagonist = roleName(roles[2], "黑袍人");
    const kind = inferScenario(theme, direction, style);
    const deck = scenarioDeck(kind, { protagonist, partner, antagonist, theme, audience, duration, episodeCount, style, direction }, input);

    return {
      title: `《${theme}》第1集：${deck.titleSuffix}`,
      synopsis: `${deck.synopsis} 本集面向${audience}，风格为${style}，单集控制在${duration}秒；如果做${episodeCount}集系列，第一集只解决“观众为什么要追下去”。`,
      characters: [
        ...deck.characterNotes.map((description) => {
          const [name, note] = description.split("：");
          return { name: name || "角色", description: note || description };
        }),
        { name: "学院广播", description: "用警报、倒计时或任务提示压缩解释成本，适合抖音短剧的信息卡表达。" },
      ],
      structure: deck.beats.map(([beat, content]) => ({ beat, content })),
      dialogue: deck.dialogue.map(([role, line]) => ({ role, line })),
      rhythm: [
        `停留：开头直接给“${deck.beats[0][1]}”这种反常识画面。`,
        `代入：让${protagonist}先被误解或被击中情绪，再进入行动。`,
        `追看：中段每10-15秒出现新线索，避免解释世界观。`,
        `爆点：把${partner}的主动选择放在后半段，形成情绪峰值。`,
        `催更：结尾不讲完设定，只留下下一集必须回答的问题。`,
      ],
      reversals: deck.reversals,
      hooks: [
        ...deck.hooks,
        `系列方向：${episodeCount}集内完成“单集危机-角色选择-旧契约秘密-学院主线升级”。`,
        `标题测试：${theme} / ${deck.titleSuffix} / ${partner}为什么会这样？`,
      ],
      tags: ["洛克王国二创", "粉丝向短剧", direction, style, kind, audience],
    };
  }

  function generateStoryboard(script, input = {}) {
    const duration = num(input.duration) || 60;
    const roles = splitRoles(input.roles);
    const protagonist = roles[0]?.split(/[：:]/)[0] || script?.characters?.[0]?.name || "阿洛";
    const partner = roles[1]?.split(/[：:]/)[0] || script?.characters?.[1]?.name || "迪莫";
    const antagonist = roles[2]?.split(/[：:]/)[0] || script?.characters?.[2]?.name || "黑袍人";
    const base = [
      [`手机特写，弹出“${partner}已等待3652天”`, `${protagonist}手指停住`, "等了我十年？", "特写", "快速推近", "心跳+系统提示音", "它等了我3652天"],
      ["旧账号登录界面切到魔法学院入口", `${protagonist}输入密码，屏幕亮起`, "十年了，这账号还能登？", "中景", "轻微前推", "键盘声+怀旧铃声", "旧账号，登录成功"],
      ["系统红字显示“契约状态：失效”", `${protagonist}沉默，手离开鼠标`, `果然，连${partner}也不在了。`, "特写", "定格", "低沉音效", "契约失效"],
      ["背包角落的旧徽章裂开发光", "徽章震动，光从缝隙溢出", "可背包里，有东西醒了。", "物件特写", "微距推拉", "魔法声", "旧徽章亮了"],
      [`金色光里出现${partner}的轮廓`, `${partner}抬头看向${protagonist}`, "谁说我不在？", "中近景", "慢推", "温暖BGM进入", "谁说我不在？"],
      [`${protagonist}眼眶发红，靠近屏幕`, "他伸手想碰屏幕", "你怎么还记得我？", "近景", "手持微晃", "呼吸声", "它真的记得我"],
      [`${partner}挡在徽章前，进入战斗姿态`, `光芒从徽章连到${partner}身上`, "因为你还没说，冒险结束。", "中景", "环绕轻移", "弦乐上扬", "冒险还没结束"],
      ["学院警报弹窗，屏幕变红", `${protagonist}后退，${partner}护在前面`, "警告！旧契约徽章被锁定！", "特写", "快切", "警报声", "徽章被锁定"],
      [`${antagonist}的剪影出现在学院深处`, `${antagonist}伸手，徽章光芒被拉扯`, "终于找到了，第一枚旧契约徽章。", "远景转特写", "急推+黑场", "反转音", "第一枚旧契约？"],
      ["黑场标题卡，下一封魔法信落下", "信封上出现另一个精灵名字", "下一集，他才知道自己不是登录游戏，而是被王国召唤了。", "标题卡", "静止", "悬疑BGM", "下一集：王国召唤"],
    ];

    const weights = base.map((_, index) => (index === 0 ? 0.6 : index === base.length - 1 ? 0.8 : 1));
    const total = weights.reduce((sum, value) => sum + value, 0);
    const seconds = weights.map((weight) => Math.max(3, Math.round((duration * weight) / total)));
    let diff = duration - seconds.reduce((sum, value) => sum + value, 0);
    let guard = 0;
    while (diff !== 0 && guard < 100) {
      const direction = Math.sign(diff);
      for (let i = seconds.length - 1; i >= 0 && diff !== 0; i -= 1) {
        if (seconds[i] + direction >= 3) {
          seconds[i] += direction;
          diff -= direction;
        }
      }
      guard += 1;
    }

    return base.map((row, index) => ({
      shot: index + 1,
      seconds: seconds[index],
      visual: row[0],
      action: row[1],
      line: row[2],
      scale: row[3],
      movement: row[4],
      sound: row[5],
      subtitle: row[6],
    }));
  }

  function generateStoryboardV2(script, input = {}) {
    const duration = num(input.duration) || 60;
    const roles = splitRoles(input.roles);
    const protagonist = roleName(roles[0], script?.characters?.[0]?.name || "阿洛");
    const partner = roleName(roles[1], script?.characters?.[1]?.name || "迪莫");
    const antagonist = roleName(roles[2], script?.characters?.[2]?.name || "黑袍人");
    const structure = script?.structure || [];
    const dialogue = script?.dialogue || [];
    const findLine = (roleFallback, indexFallback) => {
      const item = dialogue.find((line) => line.role === roleFallback) || dialogue[indexFallback] || dialogue[0];
      return item ? `${item.role}：“${item.line}”` : "";
    };
    const beatText = (index, fallback) => structure[index]?.content || fallback;
    const base = [
      [
        `竖屏开场，直接呈现：${beatText(0, `${partner}出现异常提示`)}`,
        `${protagonist}停住动作，镜头压近表情`,
        findLine(protagonist, 0),
        "特写",
        "快速推近",
        "心跳+系统提示音",
        beatText(0, "开头必须有异常"),
      ],
      [
        `魔法学院入口或任务界面，展示本集主题：${script?.title || input.theme}`,
        `${protagonist}确认任务，${partner}站在画面中心`,
        findLine(partner, 1),
        "中景",
        "轻微前推",
        "学院钟声+低频铺底",
        "本集危机出现",
      ],
      [
        beatText(1, "冲突升级，角色关系被质疑"),
        "旁观角色或系统提示制造压力",
        findLine("系统", 2),
        "近景",
        "快切",
        "提示音+人群低语",
        "冲突被放大",
      ],
      [
        beatText(2, "主角发现第一条线索"),
        `${protagonist}捡起关键道具或查看记忆水晶`,
        "旁白：“问题不在表面。”",
        "物件特写",
        "微距推拉",
        "玻璃裂纹声+悬疑鼓点",
        "第一条线索出现",
      ],
      [
        `${partner}做出主动选择，证明它不是被动等待的宠物`,
        `${partner}挡在${protagonist}前面或走向危险区域`,
        findLine(partner, 3),
        "中近景",
        "慢推",
        "BGM抽空，只留呼吸声",
        "它选择了主人",
      ],
      [
        beatText(3, "情绪爆点出现"),
        `${protagonist}从犹豫转为行动`,
        findLine(protagonist, 4),
        "近景",
        "手持微晃",
        "弦乐上扬",
        "主角不再逃避",
      ],
      [
        `危机源头露出：${antagonist}或隐藏规则开始干预`,
        `${antagonist}的影子压过画面边缘`,
        findLine(antagonist, 5),
        "远景转特写",
        "急推",
        "反转音效",
        "真正目标出现",
      ],
      [
        beatText(4, "反转信息揭晓"),
        "关键道具发光，旧地图或徽章被激活",
        "旁白：“原来这才是本集真相。”",
        "大特写",
        "闪白转场",
        "魔法爆发声",
        "反转成立",
      ],
      [
        "角色短暂停顿，给观众消化反转",
        `${protagonist}和${partner}对视，准备进入下一集任务`,
        script?.reversals?.[0] || "真相不是表面看到的那样。",
        "双人中景",
        "缓慢后拉",
        "BGM降下来",
        "下一集还有更大的问题",
      ],
      [
        `黑场标题卡：${script?.hooks?.[0] || "下一集继续"}`,
        "魔法信、徽章或记忆碎片落到画面中央",
        script?.hooks?.[1] || "评论区告诉我你想看谁登场。",
        "标题卡",
        "静止",
        "悬疑尾音",
        "下一集钩子",
      ],
    ];

    const weights = base.map((_, index) => (index === 0 ? 0.6 : index === base.length - 1 ? 0.8 : 1));
    const total = weights.reduce((sum, value) => sum + value, 0);
    const seconds = weights.map((weight) => Math.max(3, Math.round((duration * weight) / total)));
    let diff = duration - seconds.reduce((sum, value) => sum + value, 0);
    let guard = 0;
    while (diff !== 0 && guard < 100) {
      const direction = Math.sign(diff);
      for (let i = seconds.length - 1; i >= 0 && diff !== 0; i -= 1) {
        if (seconds[i] + direction >= 3) {
          seconds[i] += direction;
          diff -= direction;
        }
      }
      guard += 1;
    }

    return base.map((row, index) => ({
      shot: index + 1,
      seconds: seconds[index],
      visual: row[0],
      action: row[1],
      line: row[2],
      scale: row[3],
      movement: row[4],
      sound: row[5],
      subtitle: row[6],
    }));
  }

  function analyzeCompetitors(rows = seedCompetitors) {
    const ranked = rows
      .map((row) => ({ ...row, rate: interactionRate(row), saveShareRate: (num(row.favorites) + num(row.shares)) / Math.max(num(row.views), 1) }))
      .sort((a, b) => b.rate - a.rate);
    const avgViews = rows.reduce((sum, row) => sum + num(row.views), 0) / Math.max(rows.length, 1);
    const avgRate = rows.reduce((sum, row) => sum + interactionRate(row), 0) / Math.max(rows.length, 1);
    const top = ranked[0];

    return {
      summary: `共分析 ${rows.length} 条样例，平均播放约 ${Math.round(avgViews).toLocaleString()}，平均互动率 ${pct(avgRate)}。当前最高互动样例是《${top.title}》，互动率 ${pct(top.rate)}。`,
      findings: [
        `高互动内容通常同时具备“童年记忆 + 当前危机 + 明确反转”，例如《${top.title}》。`,
        "收藏高的视频偏设定盘点、宠物进化、隐藏任务；转发高的视频偏怀旧重逢和情绪共鸣。",
        "评论区出现“下一集、童年、泪目、这只我有过”时，说明系列化和角色留存空间较大。",
      ],
      recommendations: [
        "开头3秒直接抛出系统提示、宠物消失、徽章异常等强信息。",
        "每条短剧只讲一个主冲突，结尾保留一个未解问题。",
        "封面文字控制在10字内，优先用“等了十年”“契约失效”“它还记得我”。",
        "后续采集真实数据后，用互动率、完播率、转粉率共同决定选题优先级。",
      ],
    };
  }

  function generateTopics(competitorRows = seedCompetitors) {
    const topTheme = [...competitorRows].sort((a, b) => interactionRate(b) - interactionRate(a))[0]?.theme || "童年重逢";
    const topics = [
      ["它在背包里等了我3652天", "老玩家回归，第一只精灵仍守着旧契约", "18-30岁老玩家", "怀旧、亏欠、重逢", "精灵不是被召回，而是一直没离开", 60, true],
      ["魔法学院最弱新生，契约了没人要的宠物", "废柴主角与低估宠物共同逆袭", "学生党、爽剧用户", "委屈、热血", "没人要的宠物克制最终Boss", 75, true],
      ["全班都忘了阿洛，只有迪莫记得他的名字", "失忆危机叠加宠物羁绊", "怀旧情绪用户", "孤独、守护", "迪莫装作不认识是为了保护阿洛", 80, true],
      ["如果洛克王国也有期末考试", "游戏设定校园化，适合评论整活", "学生党、轻喜剧用户", "好笑、代入", "考试题其实是学院求救暗号", 45, true],
      ["最弱宠物排行榜最后一名，救了整个学院", "反差爽点强，封面好做", "泛短剧用户", "被嘲笑、逆袭", "弱技能正好能破解暗影魔法", 70, true],
      ["我在王国遇见了小时候的自己", "穿越治愈，老玩家和童年自己对话", "老玩家、治愈向用户", "遗憾、释怀", "小时候的自己才是任务发布人", 60, true],
      ["宠物不愿进化，因为进化后会忘记主人", "进化选择带来情绪冲突", "亲子/情感向用户", "纠结、感动", "进化条件是主人先学会告别", 76, true],
      ["旧徽章里藏着所有小洛克的名字", "主线悬疑，适合作为系列核心", "剧情党、设定党", "悬疑、使命感", "反派曾经也是被遗忘的小洛克", 90, true],
    ];

    return topics.map((item, index) => ({
      title: item[0],
      sellingPoint: item[1],
      audience: item[2],
      emotion: item[3],
      reversal: item[4],
      duration: item[5],
      series: item[6],
      priority: index < 3 || item[0].includes(topTheme) ? "S" : index < 6 ? "A" : "B",
    }));
  }

  function generateCreativePack(script, input = {}, topics = []) {
    const theme = clean(input.theme, "旧契约徽章醒来");
    const roles = splitRoles(input.roles);
    const protagonist = roles[0]?.split(/[：:]/)[0] || "阿洛";
    const partner = roles[1]?.split(/[：:]/)[0] || "迪莫";
    const titleRoot = script?.title?.replace(/[《》]/g, "") || theme;
    const topTopic = topics[0]?.title || "它在背包里等了我3652天";
    return {
      titleVariants: [
        { type: "数字怀旧", text: `${partner}在背包里等了我3652天`, reason: "数字降低理解成本，直接拉老玩家停留。" },
        { type: "冲突悬疑", text: `契约失效后，${partner}为什么还在？`, reason: "把反常识问题前置，适合首发测试。" },
        { type: "情绪亏欠", text: `十年没上线，我的第一只精灵还记得我`, reason: "触发童年亏欠感，评论区容易自曝经历。" },
        { type: "反转爽点", text: `全学院都说它没用，只有我知道它在等一个命令`, reason: "弱者逆袭结构清晰，适合连续剧。" },
        { type: "主线悬疑", text: `旧徽章里，藏着所有小洛克的名字`, reason: "把单集钩子升级成系列主线。" },
        { type: "口语提问", text: `如果你的第一只精灵还在等你，你会回去吗？`, reason: "适合引导评论和转发给同龄玩家。" },
      ],
      coverVariants: [
        { text: "它等了我十年", visual: `${partner}特写 + 发光旧徽章 + ${protagonist}震惊表情`, risk: "情绪强，但需要画面能看清精灵。" },
        { text: "契约失效？", visual: "系统红字弹窗 + 黑场背景 + 一道金色裂缝", risk: "悬疑强，人物温度略低。" },
        { text: "它还记得我", visual: "主角手碰屏幕，精灵轮廓隔屏回应", risk: "适合催泪，爆发力不如战斗封面。" },
        { text: "第一枚旧徽章", visual: "徽章居中，反派剪影在背后伸手", risk: "系列感强，需在标题补充洛克王国语境。" },
      ],
      openingHooks: [
        `系统提示：${partner}已等待3652天。`,
        `${protagonist}刚登上旧账号，契约状态却显示失效。`,
        `所有人都忘了${protagonist}，只有${partner}叫出了他的名字。`,
        "魔法学院警报响起，目标不是宠物，是一枚旧徽章。",
      ],
      ctaLines: [
        `如果你的第一只精灵还在，你想对它说什么？`,
        `下一集先救${partner}，还是先查旧徽章？`,
        "评论区留下你的第一只精灵，我把高频角色写进下一集。",
        `想看${titleRoot}继续更新，就选一个封面文案。`,
      ],
      productionChecklist: [
        "前3秒必须出现系统提示、契约失效或徽章异常。",
        "每个镜头字幕不超过两行，最长一句控制在18字以内。",
        "结尾不要解释完，必须留下下一集问题。",
        "发布前确认文案标注粉丝向二创，不暗示官方授权。",
        `本集核心承诺：${topTopic}。所有镜头都服务这个承诺。`,
      ],
    };
  }

  function generatePublishPlan(topics = generateTopics(seedCompetitors), analysis = analyzeCompetitors(seedCompetitors)) {
    const slots = ["12:10", "18:30", "20:30", "22:15"];
    const goals = ["测开头钩子", "测封面情绪", "测评论互动", "测系列追更"];
    return topics.slice(0, 7).map((topic, index) => ({
      day: `第${index + 1}天`,
      time: slots[index % slots.length],
      title: topic.title,
      goal: goals[index % goals.length],
      test: index % 2 === 0 ? "A版：怀旧标题；B版：悬疑标题" : "A版：宠物特写；B版：系统弹窗",
      targetMetric: index < 3 ? "3秒留存、完播率、评论率" : "转粉率、催更评论、分享率",
      nextAction: index === 6 ? "汇总一周数据，保留最高转粉角色做主线" : "次日复用高互动元素，替换低留存镜头",
      source: analysis.summary,
    }));
  }

  function toCsv(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return "";
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const escape = (value) => {
      const text = value == null ? "" : String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [headers.join(","), ...rows.map((row) => headers.map((key) => escape(row[key])).join(","))].join("\r\n");
  }

  window.RocoStudio = {
    constants,
    seedCompetitors,
    scoreCompetitors,
    generateScript: generateScriptV2,
    generateStoryboard: generateStoryboardV2,
    analyzeCompetitors,
    generateTopics,
    generateCreativePack,
    generatePublishPlan,
    toCsv,
  };
})();
