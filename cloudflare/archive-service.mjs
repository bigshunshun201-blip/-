const MAX_REQUEST_BYTES = 2_000_000;
const MAX_ARCHIVE_TOTAL_BYTES = 16_000_000;
const MAX_ARCHIVE_CHUNK_BYTES = 450_000;
const MAX_ARCHIVE_CHUNKS = 40;
const RETAINED_ARCHIVE_VERSIONS = 20;

function codedError(message, code) {
  const cause = new Error(message);
  cause.code = code;
  return cause;
}

function bytes(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function bytesToHex(value) {
  return [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || ""))));
}

async function readArchiveRequest(request) {
  if (!request.body) throw codedError("备份请求缺少内容。", "INVALID_ARCHIVE_REQUEST");
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > MAX_REQUEST_BYTES) throw codedError("单次备份请求超过 2MB，请使用分块备份。", "ARCHIVE_TOO_LARGE");
  const raw = await request.text();
  if (bytes(raw) > MAX_REQUEST_BYTES) throw codedError("单次备份请求超过 2MB，请使用分块备份。", "ARCHIVE_TOO_LARGE");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    throw codedError("备份内容不是有效 JSON。", "INVALID_ARCHIVE_REQUEST");
  }
}

async function archiveWorkspaceHash(workspaceKey) {
  const key = String(workspaceKey || "").trim();
  if (!/^roco_[a-f0-9]{64}$/i.test(key)) throw codedError("恢复密钥无效。", "INVALID_WORKSPACE_KEY");
  return sha256(key);
}

function requireDb(env) {
  if (!env.USAGE_DB) throw codedError("云端档案数据库不可用。", "ARCHIVE_DB_UNAVAILABLE");
  return env.USAGE_DB;
}

async function archiveHead(db, workspaceHash) {
  return db.prepare(
    `SELECT current_revision AS currentRevision,
      (SELECT checksum FROM project_archive_versions WHERE workspace_hash = ? ORDER BY revision DESC LIMIT 1) AS currentChecksum
     FROM archive_workspaces WHERE workspace_hash = ?`,
  ).bind(workspaceHash, workspaceHash).first();
}

function assertBaseRevision(currentRevision, rawBaseRevision) {
  const baseRevision = rawBaseRevision === null || rawBaseRevision === undefined ? null : Number(rawBaseRevision);
  if ((currentRevision > 0 && baseRevision === null) || (baseRevision !== null && baseRevision !== currentRevision)) {
    throw codedError("云端已有更新版本，请先刷新恢复点后再备份。", "ARCHIVE_VERSION_CONFLICT");
  }
  return baseRevision ?? 0;
}

async function archiveList(env, workspaceHash) {
  const db = requireDb(env);
  const head = await db.prepare(
    "SELECT current_revision AS currentRevision, updated_at AS updatedAt FROM archive_workspaces WHERE workspace_hash = ?",
  ).bind(workspaceHash).first();
  const result = await db.prepare(
    `SELECT revision, checksum, project_count AS projectCount, created_at AS createdAt,
      storage_mode AS storageMode, payload_bytes AS byteCount
     FROM project_archive_versions WHERE workspace_hash = ? ORDER BY revision DESC LIMIT ?`,
  ).bind(workspaceHash, RETAINED_ARCHIVE_VERSIONS).all();
  return {
    currentRevision: Number(head?.currentRevision || 0),
    updatedAt: head?.updatedAt || null,
    versions: (result?.results || []).map((item) => ({
      ...item,
      revision: Number(item.revision),
      projectCount: Number(item.projectCount || 0),
      byteCount: Number(item.byteCount || 0),
      storageMode: item.storageMode || "inline",
    })),
  };
}

function archivePayload(archive) {
  if (!archive || !Array.isArray(archive.projects)) throw codedError("备份中缺少项目档案。", "INVALID_ARCHIVE_REQUEST");
  const payloadJson = JSON.stringify(archive);
  if (bytes(payloadJson) > MAX_REQUEST_BYTES) throw codedError("云端备份超过 2MB，请使用分块备份。", "ARCHIVE_TOO_LARGE");
  return payloadJson;
}

async function cleanupStatements(db, workspaceHash) {
  return [
    db.prepare(`
      DELETE FROM project_archive_chunks
      WHERE workspace_hash = ? AND revision NOT IN (
        SELECT revision FROM project_archive_versions WHERE workspace_hash = ? ORDER BY revision DESC LIMIT ?
      )
    `).bind(workspaceHash, workspaceHash, RETAINED_ARCHIVE_VERSIONS),
    db.prepare(`
      DELETE FROM project_archive_versions
      WHERE workspace_hash = ? AND revision NOT IN (
        SELECT revision FROM project_archive_versions WHERE workspace_hash = ? ORDER BY revision DESC LIMIT ?
      )
    `).bind(workspaceHash, workspaceHash, RETAINED_ARCHIVE_VERSIONS),
  ];
}

async function saveInlineArchive(env, body) {
  const workspaceHash = await archiveWorkspaceHash(body.workspaceKey);
  const payloadJson = archivePayload(body.archive);
  const db = requireDb(env);
  const current = await archiveHead(db, workspaceHash);
  const currentRevision = Number(current?.currentRevision || 0);
  assertBaseRevision(currentRevision, body.baseRevision);
  const now = new Date().toISOString();
  const checksum = await sha256(payloadJson);
  if (currentRevision > 0 && current?.currentChecksum === checksum) {
    return { revision: currentRevision, checksum, projectCount: body.archive.projects.length, createdAt: now, unchanged: true, storageMode: "inline", byteCount: bytes(payloadJson) };
  }
  const revision = currentRevision + 1;
  const cleanup = await cleanupStatements(db, workspaceHash);
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO archive_workspaces (workspace_hash, current_revision, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_hash) DO UPDATE SET current_revision = excluded.current_revision, updated_at = excluded.updated_at
        WHERE current_revision = ?
      `).bind(workspaceHash, revision, now, now, currentRevision),
      db.prepare(`
        INSERT INTO project_archive_versions
          (workspace_hash, revision, payload_json, checksum, project_count, created_at, storage_mode, payload_bytes)
        VALUES (?, ?, ?, ?, ?, ?, 'inline', ?)
      `).bind(workspaceHash, revision, payloadJson, checksum, body.archive.projects.length, now, bytes(payloadJson)),
      ...cleanup,
    ]);
  } catch (cause) {
    const latest = await archiveHead(db, workspaceHash);
    if (Number(latest?.currentRevision || 0) !== currentRevision) throw codedError("云端已有更新版本，请先刷新恢复点后再备份。", "ARCHIVE_VERSION_CONFLICT");
    throw cause;
  }
  return { revision, checksum, projectCount: body.archive.projects.length, createdAt: now, storageMode: "inline", byteCount: bytes(payloadJson) };
}

async function prepareChunkedArchive(env, body) {
  const workspaceHash = await archiveWorkspaceHash(body.workspaceKey);
  const db = requireDb(env);
  const current = await archiveHead(db, workspaceHash);
  const currentRevision = Number(current?.currentRevision || 0);
  const baseRevision = assertBaseRevision(currentRevision, body.baseRevision);
  const chunkCount = Number(body.chunkCount || 0);
  const totalBytes = Number(body.totalBytes || 0);
  const checksum = String(body.checksum || "").trim().toLowerCase();
  const projectCount = Math.max(0, Number(body.projectCount || 0));
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_ARCHIVE_CHUNKS) throw codedError("备份分块数量无效。", "INVALID_ARCHIVE_REQUEST");
  if (!Number.isInteger(totalBytes) || totalBytes < 2 || totalBytes > MAX_ARCHIVE_TOTAL_BYTES) throw codedError("云端恢复点超过 16MB 上限。", "ARCHIVE_TOO_LARGE");
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw codedError("备份校验值无效。", "INVALID_ARCHIVE_REQUEST");
  if (currentRevision > 0 && current?.currentChecksum === checksum) {
    return { unchanged: true, revision: currentRevision, checksum, projectCount, storageMode: "chunked", byteCount: totalBytes };
  }
  const uploadId = crypto.randomUUID();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare(`
      INSERT INTO archive_uploads
        (workspace_hash, upload_id, base_revision, archive_checksum, chunk_count, total_bytes, project_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(workspaceHash, uploadId, baseRevision, checksum, chunkCount, totalBytes, projectCount, now),
    db.prepare("DELETE FROM archive_upload_chunks WHERE workspace_hash = ? AND upload_id IN (SELECT upload_id FROM archive_uploads WHERE workspace_hash = ? AND created_at < ?)").bind(workspaceHash, workspaceHash, staleBefore),
    db.prepare("DELETE FROM archive_uploads WHERE workspace_hash = ? AND created_at < ?").bind(workspaceHash, staleBefore),
  ]);
  return { uploadId, chunkCount, totalBytes, checksum, baseRevision, storageMode: "chunked" };
}

function validUploadId(value) {
  const uploadId = String(value || "").trim();
  if (!/^[a-f0-9-]{20,80}$/i.test(uploadId)) throw codedError("分块上传标识无效。", "INVALID_ARCHIVE_REQUEST");
  return uploadId;
}

async function saveArchiveChunk(env, body) {
  const workspaceHash = await archiveWorkspaceHash(body.workspaceKey);
  const uploadId = validUploadId(body.uploadId);
  const chunkIndex = Number(body.chunkIndex);
  const payloadText = typeof body.payloadText === "string" ? body.payloadText : "";
  const byteCount = bytes(payloadText);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !payloadText) throw codedError("备份分块内容无效。", "INVALID_ARCHIVE_REQUEST");
  if (byteCount > MAX_ARCHIVE_CHUNK_BYTES) throw codedError("单个备份分块超过 450KB。", "ARCHIVE_TOO_LARGE");
  const db = requireDb(env);
  const upload = await db.prepare("SELECT chunk_count AS chunkCount FROM archive_uploads WHERE workspace_hash = ? AND upload_id = ?").bind(workspaceHash, uploadId).first();
  if (!upload || chunkIndex >= Number(upload.chunkCount || 0)) throw codedError("分块上传会话不存在或已过期。", "ARCHIVE_NOT_FOUND");
  const chunkChecksum = await sha256(payloadText);
  await db.prepare(`
    INSERT INTO archive_upload_chunks (workspace_hash, upload_id, chunk_index, payload_text, chunk_checksum, byte_count)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_hash, upload_id, chunk_index) DO UPDATE SET
      payload_text = excluded.payload_text, chunk_checksum = excluded.chunk_checksum, byte_count = excluded.byte_count
  `).bind(workspaceHash, uploadId, chunkIndex, payloadText, chunkChecksum, byteCount).run();
  return { uploadId, chunkIndex, chunkChecksum, byteCount };
}

async function commitChunkedArchive(env, body) {
  const workspaceHash = await archiveWorkspaceHash(body.workspaceKey);
  const uploadId = validUploadId(body.uploadId);
  const db = requireDb(env);
  const upload = await db.prepare(`
    SELECT base_revision AS baseRevision, archive_checksum AS checksum, chunk_count AS chunkCount,
      total_bytes AS totalBytes, project_count AS projectCount
    FROM archive_uploads WHERE workspace_hash = ? AND upload_id = ?
  `).bind(workspaceHash, uploadId).first();
  if (!upload) throw codedError("分块上传会话不存在或已过期。", "ARCHIVE_NOT_FOUND");
  const rows = await db.prepare(`
    SELECT chunk_index AS chunkIndex, payload_text AS payloadText, chunk_checksum AS chunkChecksum, byte_count AS byteCount
    FROM archive_upload_chunks WHERE workspace_hash = ? AND upload_id = ? ORDER BY chunk_index ASC
  `).bind(workspaceHash, uploadId).all();
  const chunks = rows?.results || [];
  const expectedCount = Number(upload.chunkCount || 0);
  if (chunks.length !== expectedCount || chunks.some((item, index) => Number(item.chunkIndex) !== index)) throw codedError("备份分块尚未完整上传。", "ARCHIVE_CHUNKS_INCOMPLETE");
  const payloadJson = chunks.map((item) => item.payloadText).join("");
  if (bytes(payloadJson) !== Number(upload.totalBytes) || await sha256(payloadJson) !== upload.checksum) throw codedError("备份分块校验失败，请重新上传。", "ARCHIVE_CHECKSUM_MISMATCH");
  let archive;
  try {
    archive = JSON.parse(payloadJson);
  } catch (_) {
    throw codedError("合并后的备份不是有效 JSON。", "INVALID_ARCHIVE_REQUEST");
  }
  if (!archive || !Array.isArray(archive.projects) || archive.projects.length !== Number(upload.projectCount)) throw codedError("合并后的项目数量与清单不一致。", "ARCHIVE_CHECKSUM_MISMATCH");
  const current = await archiveHead(db, workspaceHash);
  const currentRevision = Number(current?.currentRevision || 0);
  assertBaseRevision(currentRevision, Number(upload.baseRevision));
  if (currentRevision > 0 && current?.currentChecksum === upload.checksum) {
    await db.batch([
      db.prepare("DELETE FROM archive_upload_chunks WHERE workspace_hash = ? AND upload_id = ?").bind(workspaceHash, uploadId),
      db.prepare("DELETE FROM archive_uploads WHERE workspace_hash = ? AND upload_id = ?").bind(workspaceHash, uploadId),
    ]);
    return { revision: currentRevision, checksum: upload.checksum, projectCount: archive.projects.length, unchanged: true, storageMode: "chunked", byteCount: Number(upload.totalBytes) };
  }
  const revision = currentRevision + 1;
  const now = new Date().toISOString();
  const manifest = JSON.stringify({ formatVersion: 2, chunked: true, chunkCount: expectedCount, totalBytes: Number(upload.totalBytes) });
  const cleanup = await cleanupStatements(db, workspaceHash);
  const statements = [
    db.prepare(`
      INSERT INTO archive_workspaces (workspace_hash, current_revision, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_hash) DO UPDATE SET current_revision = excluded.current_revision, updated_at = excluded.updated_at
      WHERE current_revision = ?
    `).bind(workspaceHash, revision, now, now, currentRevision),
    db.prepare(`
      INSERT INTO project_archive_versions
        (workspace_hash, revision, payload_json, checksum, project_count, created_at, storage_mode, payload_bytes)
      VALUES (?, ?, ?, ?, ?, ?, 'chunked', ?)
    `).bind(workspaceHash, revision, manifest, upload.checksum, archive.projects.length, now, Number(upload.totalBytes)),
    ...chunks.map((item) => db.prepare(`
      INSERT INTO project_archive_chunks (workspace_hash, revision, chunk_index, payload_text, chunk_checksum, byte_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(workspaceHash, revision, Number(item.chunkIndex), item.payloadText, item.chunkChecksum, Number(item.byteCount))),
    db.prepare("DELETE FROM archive_upload_chunks WHERE workspace_hash = ? AND upload_id = ?").bind(workspaceHash, uploadId),
    db.prepare("DELETE FROM archive_uploads WHERE workspace_hash = ? AND upload_id = ?").bind(workspaceHash, uploadId),
    ...cleanup,
  ];
  try {
    await db.batch(statements);
  } catch (cause) {
    const latest = await archiveHead(db, workspaceHash);
    if (Number(latest?.currentRevision || 0) !== currentRevision) throw codedError("云端已有更新版本，请先刷新恢复点后再备份。", "ARCHIVE_VERSION_CONFLICT");
    throw cause;
  }
  return { revision, checksum: upload.checksum, projectCount: archive.projects.length, createdAt: now, storageMode: "chunked", byteCount: Number(upload.totalBytes), chunkCount: expectedCount };
}

async function loadArchive(env, body) {
  const workspaceHash = await archiveWorkspaceHash(body.workspaceKey);
  const db = requireDb(env);
  const requestedRevision = Math.max(0, Number(body.revision || 0));
  const row = requestedRevision
    ? await db.prepare("SELECT revision, payload_json AS payloadJson, checksum, created_at AS createdAt, storage_mode AS storageMode, payload_bytes AS byteCount FROM project_archive_versions WHERE workspace_hash = ? AND revision = ?").bind(workspaceHash, requestedRevision).first()
    : await db.prepare("SELECT revision, payload_json AS payloadJson, checksum, created_at AS createdAt, storage_mode AS storageMode, payload_bytes AS byteCount FROM project_archive_versions WHERE workspace_hash = ? ORDER BY revision DESC LIMIT 1").bind(workspaceHash).first();
  if (!row) throw codedError("没有找到对应的云端恢复点。", "ARCHIVE_NOT_FOUND");
  let payloadJson = row.payloadJson;
  if (row.storageMode === "chunked") {
    const manifest = JSON.parse(row.payloadJson);
    const result = await db.prepare("SELECT chunk_index AS chunkIndex, payload_text AS payloadText, chunk_checksum AS chunkChecksum FROM project_archive_chunks WHERE workspace_hash = ? AND revision = ? ORDER BY chunk_index ASC").bind(workspaceHash, Number(row.revision)).all();
    const chunks = result?.results || [];
    if (chunks.length !== Number(manifest.chunkCount) || chunks.some((item, index) => Number(item.chunkIndex) !== index)) throw codedError("云端恢复点分块不完整。", "ARCHIVE_CHUNKS_INCOMPLETE");
    payloadJson = chunks.map((item) => item.payloadText).join("");
    if (await sha256(payloadJson) !== row.checksum) throw codedError("云端恢复点校验失败。", "ARCHIVE_CHECKSUM_MISMATCH");
  }
  let archive;
  try {
    archive = JSON.parse(payloadJson);
  } catch (_) {
    throw codedError("云端恢复点内容损坏。", "ARCHIVE_CHECKSUM_MISMATCH");
  }
  return {
    revision: Number(row.revision), checksum: row.checksum, createdAt: row.createdAt,
    storageMode: row.storageMode || "inline", byteCount: Number(row.byteCount || bytes(payloadJson)), archive,
  };
}

async function handleArchiveRequest(request, env, pathname) {
  if (request.method !== "POST") throw codedError("Not found", "NOT_FOUND");
  const body = await readArchiveRequest(request);
  if (pathname === "/api/archive/save") return saveInlineArchive(env, body);
  if (pathname === "/api/archive/prepare") return prepareChunkedArchive(env, body);
  if (pathname === "/api/archive/chunk") return saveArchiveChunk(env, body);
  if (pathname === "/api/archive/commit") return commitChunkedArchive(env, body);
  if (pathname === "/api/archive/list") return archiveList(env, await archiveWorkspaceHash(body.workspaceKey));
  if (pathname === "/api/archive/load") return loadArchive(env, body);
  throw codedError("Not found", "NOT_FOUND");
}

export {
  MAX_ARCHIVE_TOTAL_BYTES,
  MAX_ARCHIVE_CHUNK_BYTES,
  readArchiveRequest,
  archiveWorkspaceHash,
  archiveList,
  saveInlineArchive,
  prepareChunkedArchive,
  saveArchiveChunk,
  commitChunkedArchive,
  loadArchive,
  handleArchiveRequest,
  sha256,
};
