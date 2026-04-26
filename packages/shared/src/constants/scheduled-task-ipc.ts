export const SCHEDULED_TASK_IPC_CHANNELS = {
  LIST:           'scheduled-task:list',
  CREATE:         'scheduled-task:create',
  UPDATE:         'scheduled-task:update',
  DELETE:         'scheduled-task:delete',
  PAUSE:          'scheduled-task:pause',
  RESUME:         'scheduled-task:resume',
  RUN_NOW:        'scheduled-task:run-now',
  GET_SYSTEM_SESSION_ID: 'scheduled-task:get-system-session-id',
} as const
