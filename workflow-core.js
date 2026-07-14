(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoWorkflowCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function activeVersion(episode) {
    return (episode?.versions || []).find((version) => version.id === episode.activeVersionId)
      || episode?.versions?.at(-1)
      || null;
  }

  function continuityForTarget(episodes, targetEpisodeNumber, limit = 3) {
    const target = Math.max(1, Number(targetEpisodeNumber) || 1);
    return (Array.isArray(episodes) ? episodes : [])
      .filter((episode) => episode?.script && Number(episode.episodeNumber) < target)
      .sort((a, b) => Number(b.episodeNumber) - Number(a.episodeNumber))
      .slice(0, Math.max(1, Number(limit) || 3))
      .reverse()
      .map((episode) => {
        const consistency = activeVersion(episode)?.consistency || episode.consistency || {};
        return {
          episodeNumber: Number(episode.episodeNumber),
          title: episode.script?.title || "",
          synopsis: episode.script?.synopsis || "",
          hooks: (episode.script?.hooks || []).slice(0, 2),
          mustPreserve: (consistency.mustPreserve || []).slice(0, 5),
          nextEpisodeCarryover: consistency.nextEpisodeCarryover || "",
          status: episode.review?.status || "draft",
        };
      });
  }

  function findArchivedVersion(projects, historyId) {
    for (const project of Array.isArray(projects) ? projects : []) {
      for (const episode of Array.isArray(project.episodes) ? project.episodes : []) {
        const version = (episode.versions || []).find((item) => item.historyId === historyId);
        if (version) return { project, episode, version };
        if (episode.historyId === historyId) return { project, episode, version: activeVersion(episode) || episode };
      }
    }
    return null;
  }

  function compactHistory(history) {
    return (Array.isArray(history) ? history : []).map((item) => {
      if (!item?.projectId || !item?.id) return item;
      const { script, storyboard, creativePack, input, ...metadata } = item;
      return {
        ...metadata,
        archivedInProject: true,
        inputSummary: {
          theme: input?.theme || "",
          duration: input?.duration || "",
          episodeNumber: input?.episodeNumber || item.episodeNumber || 1,
        },
      };
    });
  }

  function compactText(value, limit) {
    const text = String(value || "").trim();
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }

  function ledgerEpisodeSummary(episode) {
    const script = episode?.script || {};
    const dialogue = Array.isArray(script.dialogue) ? script.dialogue : [];
    const dialogueSignals = [...dialogue.slice(0, 1), ...dialogue.slice(-2)]
      .filter((item, index, source) => source.indexOf(item) === index)
      .map((item) => ({ id: item?.id || "", role: compactText(item?.role, 20), line: compactText(item?.line, 80) }));
    return {
      episodeNumber: Number(episode?.episodeNumber || 0),
      title: compactText(script.title, 120),
      synopsis: compactText(script.synopsis, 260),
      structure: (Array.isArray(script.structure) ? script.structure : []).slice(0, 6).map((item) => ({
        beat: compactText(item?.beat, 36),
        content: compactText(item?.content, 90),
      })),
      hooks: (Array.isArray(script.hooks) ? script.hooks : []).slice(0, 2).map((item) => compactText(typeof item === "string" ? item : JSON.stringify(item), 100)),
      dialogueSignals,
      mustPreserve: (episode?.consistency?.mustPreserve || []).slice(0, 5).map((item) => compactText(item, 160)),
      nextEpisodeCarryover: compactText(episode?.consistency?.nextEpisodeCarryover, 160),
      updatedAt: episode?.updatedAt || "",
    };
  }

  function ledgerEpisodeBatch(episodes, limit = 30) {
    return (Array.isArray(episodes) ? episodes : [])
      .filter((episode) => episode?.script)
      .sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber))
      .slice(-Math.max(1, Number(limit) || 30))
      .map(ledgerEpisodeSummary);
  }

  function hydrateHistory(history, projects) {
    return (Array.isArray(history) ? history : []).map((item) => {
      if (!item?.archivedInProject || item.script) return item;
      const archived = findArchivedVersion(projects, item.id);
      if (!archived) return item;
      return {
        ...item,
        projectId: archived.project.id,
        projectName: archived.project.name,
        episodeNumber: archived.episode.episodeNumber,
        input: archived.version.input || item.inputSummary || {},
        script: archived.version.script || archived.episode.script || null,
        storyboard: archived.version.storyboard || [],
        creativePack: archived.version.creativePack || null,
      };
    });
  }

  return { activeVersion, continuityForTarget, compactHistory, hydrateHistory, findArchivedVersion, ledgerEpisodeSummary, ledgerEpisodeBatch };
});
