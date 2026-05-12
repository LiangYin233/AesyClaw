/** 共享的仓库工具函数 */

/** 将本地日期字符串（YYYY-MM-DD）转为 UTC ISO 时间戳。
 *  endOfDay=true 返回当天末尾 23:59:59.999Z，否则返回当天开始 00:00:00.000Z。
 *  JavaScript Date 构造函数用数字参数时以本地时区解释，toISOString() 再转回 UTC。 */
/** 将本地日期字符串（YYYY-MM-DD）转为当天开始的 UTC ISO 时间戳（00:00:00.000Z） */
export function localDateToUtcStart(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d, 0, 0, 0, 0).toISOString();
}

/** 将本地日期字符串（YYYY-MM-DD）转为当天末尾的 UTC ISO 时间戳（23:59:59.999Z） */
export function localDateToUtcEnd(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d, 23, 59, 59, 999).toISOString();
}
