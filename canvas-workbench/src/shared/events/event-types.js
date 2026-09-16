// 事件名常量（执行文档 §24 推荐清单）。
export const EVENTS = Object.freeze({
  PROJECT_OPENED: 'project:opened',
  PROJECT_SAVED: 'project:saved',
  ASSET_CREATED: 'asset:created',
  ASSET_UPDATED: 'asset:updated',
  ASSET_DELETED: 'asset:deleted',
  OBJECT_CREATED: 'object:created',
  OBJECT_SELECTED: 'object:selected',
  OBJECT_UPDATED: 'object:updated',
  OBJECT_DELETED: 'object:deleted',
  JOB_CREATED: 'job:created',
  JOB_STARTED: 'job:started',
  JOB_PROGRESS: 'job:progress',
  JOB_COMPLETED: 'job:completed',
  JOB_FAILED: 'job:failed',
  JOB_CANCELLED: 'job:cancelled',
  FEATURE_ENABLED: 'feature:enabled',
  FEATURE_DISABLED: 'feature:disabled'
});
