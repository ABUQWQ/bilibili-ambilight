import { report } from '../diagnostics';

// Errors stay local in the Bilibili fork. The reporter keeps the core
// rendering pipeline from failing silently without sending telemetry.
export default class ErrorReporter {
  static captureException(ex) {
    report('captured-exception', ex, 'error');
    if (ex?.details) {
      console.error(ex, ex.details);
    } else {
      console.error(ex);
    }
  }
}
