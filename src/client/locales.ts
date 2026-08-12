/** Dictionary namespace owned by the learning view. */
export const NS = 'explain'

/** Simplified Chinese strings for the P0 learning view. */
export const zh = {
  'view.learning': '学习',
  'title.learning': '全局学习线程',
  'status.loading': '正在读取学习记录…',
  'status.empty': '还没有讲解。完成工作回合后，explain 会在值得讲解时记录到这里。',
  'status.disabled': '学习模式当前已关闭；历史仍可阅读。',
  'status.inferred': '模型推断',
  'status.noContext': '尚未生成全局学习概况',
  'section.context': '学习概况',
  'section.current': '当前会话',
  'section.otherActive': '其他会话的活跃讲解',
  'section.history': '学习历史',
  'current.none': '当前会话暂无讲解',
  'context.knowledge': '知识概况',
  'context.trend': '学习进展',
  'context.preferences': '讲解偏好',
  'metric.learning': '学习中',
  'metric.mastered': '已掌握',
  'metric.active': '待反馈',
  'metric.budget': '自主额度',
  'entry.what': '是什么',
  'entry.why': '为什么',
  'entry.pitfall': '常见坑',
  'entry.source': '来源',
  'entry.turn': '回合',
  'entry.current': '当前',
  'entry.mastered': '已掌握',
  'feedback.understood': '✓ 懂了',
  'feedback.notUnderstood': '✗ 没懂',
  'feedback.understoodRecord': '已标记为懂了',
  'feedback.notUnderstoodRecord': '请求换一种讲法',
  'action.reopen': '撤销掌握',
  'action.loadOlder': '加载更早记录',
  'action.retry': '重试',
  'action.pending': '提交中…',
  'error.generic': '学习数据暂时不可用。',
} satisfies Record<string, string>

/** Learning-view dictionary key union. */
export type ExplainKey = keyof typeof zh

/** English strings checked against the Chinese key set. */
export const en = {
  'view.learning': 'Learning',
  'title.learning': 'Global learning thread',
  'status.loading': 'Loading learning records…',
  'status.empty': 'No explanations yet. Explain will add one here when a completed work turn is worth teaching.',
  'status.disabled': 'Learning mode is off. Existing history remains readable.',
  'status.inferred': 'Model inference',
  'status.noContext': 'No global learning summary yet',
  'section.context': 'Learning overview',
  'section.current': 'Current session',
  'section.otherActive': 'Active explanations from other sessions',
  'section.history': 'Learning history',
  'current.none': 'No explanation for the current session',
  'context.knowledge': 'Knowledge overview',
  'context.trend': 'Learning progress',
  'context.preferences': 'Explanation preferences',
  'metric.learning': 'Learning',
  'metric.mastered': 'Mastered',
  'metric.active': 'Awaiting feedback',
  'metric.budget': 'Auto budget',
  'entry.what': 'What it is',
  'entry.why': 'Why it matters',
  'entry.pitfall': 'Common pitfall',
  'entry.source': 'Source',
  'entry.turn': 'Turn',
  'entry.current': 'Current',
  'entry.mastered': 'Mastered',
  'feedback.understood': '✓ Got it',
  'feedback.notUnderstood': '✗ Not yet',
  'feedback.understoodRecord': 'Marked as understood',
  'feedback.notUnderstoodRecord': 'Asked for another explanation',
  'action.reopen': 'Undo mastered',
  'action.loadOlder': 'Load earlier records',
  'action.retry': 'Retry',
  'action.pending': 'Submitting…',
  'error.generic': 'Learning data is temporarily unavailable.',
} satisfies Record<ExplainKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Global learning-view copy. */
    explain: ExplainKey
  }
}
