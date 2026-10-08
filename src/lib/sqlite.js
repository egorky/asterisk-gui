// SQLite portable: usa node:sqlite (Node >= 22.5) o better-sqlite3 (Node 20) como respaldo.
function open(file, { readOnly = false } = {}) {
  if (!process.env.FORCE_BETTER_SQLITE) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      return new DatabaseSync(file, { readOnly });
    } catch (e) {
      if (e.code !== 'ERR_UNKNOWN_BUILTIN_MODULE' && !/No such built-in module/.test(e.message)) throw e;
    }
  }
  let Database;
  try { Database = require('better-sqlite3'); } catch {
    throw new Error('Se requiere Node >= 22.5 o instalar better-sqlite3 (npm install better-sqlite3)');
  }
  return new Database(file, { readonly: readOnly, fileMustExist: readOnly });
}
module.exports = { open };
