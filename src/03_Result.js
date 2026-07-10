var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Result = (function () {
  function success(message, data) {
    return {
      ok: true,
      status: 'SUCCESS',
      message: message || 'Completed successfully',
      data: data === undefined ? null : data,
      timestamp: new Date().toISOString()
    };
  }

  function paused(message, data) {
    return {
      ok: true,
      status: 'PAUSED',
      message: message || 'Operation paused at a safe checkpoint',
      data: data === undefined ? null : data,
      timestamp: new Date().toISOString()
    };
  }

  function failure(code, message, details) {
    return {
      ok: false,
      status: 'FAILED',
      code: code || 'UNEXPECTED_ERROR',
      message: message || 'Operation failed',
      details: details === undefined ? null : details,
      timestamp: new Date().toISOString()
    };
  }

  return {
    success: success,
    paused: paused,
    failure: failure
  };
})();
