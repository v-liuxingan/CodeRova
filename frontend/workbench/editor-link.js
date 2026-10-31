// Only consume locations returned by the server's source validation API.
export function editorLink(result, editor) {
  if (editor !== 'idea') return result.uri;
  const { path, line, column } = result;
  if (typeof path !== 'string' || !path || !Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) {
    throw new Error('源码位置不完整，无法跳转 IDEA');
  }
  const normalized = path.replace(/^\\\\\?\\UNC\\/, '//').replace(/^\\\\\?\\/, '').replaceAll('\\', '/');
  return `idea://open?file=${encodeURIComponent(normalized)}&line=${line}&column=${column}`;
}
