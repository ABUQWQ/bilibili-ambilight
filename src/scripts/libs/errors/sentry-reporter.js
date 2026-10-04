import { report } from '../diagnostics';

// Bilibili 版本不包含遥测。保留同名接口以避免改动核心错误处理代码。
export const crashOptions = null;

export const parseSettingsToSentry = () => {};
export const setVersion = () => {};
export const setCrashOptions = () => {};

export default class SentryReporter {
  static captureException(ex) {
    report('captured-exception', ex, 'error');
    if (ex?.details) {
      console.error(ex, ex.details);
    } else {
      console.error(ex);
    }
  }
}
