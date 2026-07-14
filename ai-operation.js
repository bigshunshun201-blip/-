(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoAiOperation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function create(options = {}) {
    const state = options.state;

    function begin(label) {
      if (state.activeAiOperation) {
        const error = new Error(`${state.activeAiOperation.label}仍在处理中，请等待完成后再操作。`);
        error.code = "AI_OPERATION_BUSY";
        throw error;
      }
      const operation = {
        id: options.newId("ai"),
        label,
        projectId: options.getProjectId(),
        contextToken: options.getContextToken?.() || "",
        startedAt: Date.now(),
      };
      state.activeAiOperation = operation;
      options.onChange?.(operation);
      return operation;
    }

    function assertActive(operation) {
      const currentToken = options.getContextToken?.() || "";
      if (state.activeAiOperation?.id !== operation.id
        || options.getProjectId() !== operation.projectId
        || (operation.contextToken && currentToken !== operation.contextToken)) {
        const error = new Error("生成期间项目或创作输入已经变化，本次返回结果已丢弃。请按当前内容重新生成。");
        error.code = "STALE_AI_RESULT";
        throw error;
      }
    }

    function end(operation) {
      if (state.activeAiOperation?.id === operation.id) state.activeAiOperation = null;
      options.onChange?.(null);
    }

    return { begin, assertActive, end };
  }

  return { create };
});
