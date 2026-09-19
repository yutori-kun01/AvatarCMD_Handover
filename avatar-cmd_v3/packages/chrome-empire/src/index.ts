// ================================================
// @avatar-cmd/chrome-empire — Public API
// ================================================

export { ChromeEmpire } from "./pool";
export { ProfileManager } from "./profile";
export {
  executeOperations,
  type OperationStep,
  type OperationStepResult,
  type OperationsResult,
} from "./operations";
export {
  type ChromeProfile,
  type ChromeInstance,
  type InstanceMetrics,
  type PoolStatus,
  type BrowserTask,
  type TaskResult,
  type TaskType,
  type PoolEvent,
  type PoolEventListener,
  type ChromeEmpireConfig,
  DEFAULT_CONFIG,
} from "./types";
