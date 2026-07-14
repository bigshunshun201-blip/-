(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoArchiveSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function randomKey() {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return `roco_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  function parseEnvelope(stored) {
    if (Array.isArray(stored)) {
      return { formatVersion: 1, revision: 0, writerId: "legacy", updatedAt: null, projects: stored };
    }
    if (stored && typeof stored === "object" && Array.isArray(stored.projects)) {
      return {
        formatVersion: 1,
        revision: Math.max(0, Number(stored.revision || 0)),
        writerId: String(stored.writerId || ""),
        updatedAt: stored.updatedAt || null,
        projects: stored.projects,
      };
    }
    return { formatVersion: 1, revision: 0, writerId: "", updatedAt: null, projects: [] };
  }

  function create(options = {}) {
    const store = options.store;
    const apiClient = options.apiClient;
    const projectsKey = options.projectsKey || "roco-shortdrama-studio-projects";
    const workspaceKeyStorageKey = options.workspaceKeyStorageKey || "roco-shortdrama-workspace-key";
    const accessCodeStorageKey = options.accessCodeStorageKey || "roco-shortdrama-access-code";
    const storage = options.storage || globalThis.localStorage;
    const writerId = randomKey();
    const lockName = `${projectsKey}-write`;
    let localRevision = 0;
    let cloudRevision = null;
    let cloudVersions = [];
    let backupTimer = null;
    let channel = null;

    function status(message, state = "idle") {
      options.onStatus?.({ message, state, localRevision, cloudRevision, versions: cloudVersions });
    }

    function workspaceKey() {
      let key = String(storage?.getItem(workspaceKeyStorageKey) || "").trim();
      if (!key) {
        key = randomKey();
        storage?.setItem(workspaceKeyStorageKey, key);
      }
      return key;
    }

    function setWorkspaceKey(value) {
      const key = String(value || "").trim();
      if (!/^roco_[a-f0-9]{64}$/i.test(key)) throw new Error("恢复密钥格式不正确。");
      storage?.setItem(workspaceKeyStorageKey, key);
      cloudRevision = null;
      cloudVersions = [];
      status("已切换恢复密钥，等待读取云端恢复点", "idle");
      return key;
    }

    async function withWriteLock(callback) {
      if (globalThis.navigator?.locks?.request) return globalThis.navigator.locks.request(lockName, callback);
      return callback();
    }

    async function load() {
      const envelope = parseEnvelope(await store.get(projectsKey));
      localRevision = envelope.revision;
      return envelope;
    }

    async function save(projects, saveOptions = {}) {
      const snapshot = clone(projects);
      return withWriteLock(async () => {
        const current = parseEnvelope(await store.get(projectsKey));
        if (!saveOptions.force && current.revision > localRevision && current.writerId !== writerId) {
          const error = new Error("另一个标签页已经更新项目档案。为避免覆盖，当前写入已停止；请刷新页面读取最新版本。");
          error.code = "LOCAL_VERSION_CONFLICT";
          options.onConflict?.(error, current);
          throw error;
        }
        if (JSON.stringify(current.projects) === JSON.stringify(snapshot)) {
          localRevision = current.revision;
          return current;
        }
        const envelope = {
          formatVersion: 1,
          revision: Math.max(current.revision, localRevision) + 1,
          writerId,
          updatedAt: new Date().toISOString(),
          projects: snapshot,
        };
        await store.set(projectsKey, envelope);
        localRevision = envelope.revision;
        channel?.postMessage({ writerId, revision: localRevision, updatedAt: envelope.updatedAt });
        if (saveOptions.cloud !== false) scheduleCloudBackup(snapshot);
        return envelope;
      });
    }

    function apiCall(path, payload, interactive) {
      if (!apiClient) throw new Error("云端备份客户端未初始化。");
      return interactive ? apiClient.request(path, payload) : apiClient.fetchApi(path, payload);
    }

    async function listCloud(listOptions = {}) {
      status("正在读取云端恢复点...", "syncing");
      const response = await apiCall("/api/archive/list", { workspaceKey: workspaceKey() }, Boolean(listOptions.interactive));
      cloudRevision = Number(response.result?.currentRevision || 0);
      cloudVersions = Array.isArray(response.result?.versions) ? response.result.versions : [];
      status(cloudRevision ? `云端已有 ${cloudVersions.length} 个恢复点` : "云端尚无备份", "saved");
      return { currentRevision: cloudRevision, versions: cloudVersions };
    }

    async function backupNow(projects, backupOptions = {}) {
      const interactive = Boolean(backupOptions.interactive);
      if (cloudRevision === null) await listCloud({ interactive });
      status("正在创建云端恢复点...", "syncing");
      const response = await apiCall("/api/archive/save", {
        workspaceKey: workspaceKey(),
        baseRevision: cloudRevision,
        archive: {
          formatVersion: 1,
          localRevision,
          projects: clone(projects),
        },
      }, interactive);
      cloudRevision = Number(response.result?.revision || cloudRevision || 0);
      cloudVersions = [response.result, ...cloudVersions.filter((item) => Number(item.revision) !== cloudRevision)].slice(0, 20);
      status(`云端恢复点 v${cloudRevision} 已保存`, "saved");
      return response.result;
    }

    function scheduleCloudBackup(projects) {
      if (!storage?.getItem(accessCodeStorageKey)) return;
      if (backupTimer) globalThis.clearTimeout(backupTimer);
      const snapshot = clone(projects);
      backupTimer = globalThis.setTimeout(() => {
        backupTimer = null;
        backupNow(snapshot).catch((error) => {
          if (error.code === "ACCESS_CODE_REQUIRED") return;
          status(error.code === "ARCHIVE_VERSION_CONFLICT" ? "云端出现新版本，已停止自动覆盖" : `自动备份失败：${error.message}`, "error");
        });
      }, 10_000);
    }

    async function loadCloud(revision, loadOptions = {}) {
      status("正在下载云端恢复点...", "syncing");
      const response = await apiCall("/api/archive/load", {
        workspaceKey: workspaceKey(),
        revision: Math.max(0, Number(revision || 0)),
      }, loadOptions.interactive !== false);
      cloudRevision = Math.max(cloudRevision || 0, Number(response.result?.revision || 0));
      status(`已读取云端恢复点 v${response.result?.revision}`, "saved");
      return response.result;
    }

    async function connectWorkspaceKey(key) {
      setWorkspaceKey(key);
      return listCloud({ interactive: true });
    }

    if (typeof globalThis.BroadcastChannel === "function") {
      channel = new BroadcastChannel(`${projectsKey}-updates`);
      channel.addEventListener("message", (event) => {
        if (event.data?.writerId === writerId || Number(event.data?.revision || 0) <= localRevision) return;
        const error = new Error("另一个标签页已保存更新；当前页面继续写入前需要刷新。");
        error.code = "LOCAL_VERSION_CONFLICT";
        options.onConflict?.(error, { revision: Number(event.data.revision) });
      });
    }

    function dispose() {
      if (backupTimer) globalThis.clearTimeout(backupTimer);
      channel?.close();
    }

    return {
      load,
      save,
      listCloud,
      backupNow,
      loadCloud,
      workspaceKey,
      setWorkspaceKey,
      connectWorkspaceKey,
      getLocalRevision: () => localRevision,
      getCloudRevision: () => cloudRevision,
      getCloudVersions: () => [...cloudVersions],
      dispose,
    };
  }

  return { create, parseEnvelope };
});
